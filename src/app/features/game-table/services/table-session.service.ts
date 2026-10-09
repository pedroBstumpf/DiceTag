import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Point } from '../../../core/models/geometry.model';
import { WorldItem, npcSheetOf, npcTokenOf } from '../../../core/models/world-item.model';
import { LoreService } from '../../worldbuild/services/lore.service';
import { WorldbuildService } from '../../worldbuild/services/worldbuild.service';
import {
  BRUSH_COLORS,
  BRUSH_WIDTHS,
  ChatMessage,
  DEFAULT_FX,
  DEFAULT_ROLL,
  DiceKind,
  DEFAULT_SOUND_VOLUME,
  DoorWall,
  FxStyle,
  MAX_MAP_LEVELS,
  MapLevel,
  SceneFolder,
  RollResult,
  LoreFolder,
  METERS_PER_SQUARE,
  MapNote,
  NOTE_COLORS,
  Scene,
  Stroke,
  TABLE_ENTRY_META,
  TableEntry,
  TableEntryKind,
  TableRole,
  TableItem,
  TableState,
  TableTool,
  TokenBar,
  TokenPlacement,
  TokenSettings,
  TokenTag,
  Wall,
  CharacterSheet,
  InventoryEntry,
  normalizeSheet,
  defaultToken,
  NPC_TOKEN_SHEET,
  hasSheet,
  isDown,
  withStatusBars,
} from '../../../core/models/table-session.model';
import { AuthService } from '../../../core/services/auth.service';
import { newId } from '../../../core/utils/id';
import { TagLevels, baseTagId, formatRoll, keepValidItemTags, levelUpText, rollDice, studyGain, trainStudy } from '../utils/dice';
import { addOne, inventoryRow, itemTagId, itemTagLevel, quantityOf, takeOne } from '../utils/inventory';
import { SheetData, SheetStore } from '../../../core/services/sheet-store';
import { FxDrawing, buildFx, seededRandom } from '../utils/effects';
import { createMask, decodeMask, encodeMask, markPolygons, maskFits } from '../utils/fog-memory';
import { computeVisibilityPolygon, doorSeen, wallsToSegments } from '../utils/visibility';
import { FogView, visibleDoorsFor, visibleNotesFor, visibleTokensFor } from '../state/player-view';
import { TableCommandPayload, TableCommandType, applyCommand } from '../state/commands';
import { RemovedStroke, strokesToErase } from '../state/drawings';
import { findPlacement, levelOf, tokenSheetPlacement, uniqueName } from '../state/helpers';
import { clampLevelIn, levelCountOf } from '../state/levels';
import * as rules from '../state/permissions';
import { SheetAccess, Viewer } from '../state/permissions';
import { EMPTY_LORE, EMPTY_STATE, normalizeState } from '../state/table-state';
import { ResolvedToken, TokenPatch, resolveToken, splitTokenPatch } from '../state/tokens';

// Tipos e auxiliares que os componentes já importam daqui (moram em state/)
export type { ResolvedToken, SheetAccess, TokenPatch };
export { levelOf, tokenSheetPlacement };

/** Barras da mesa que podem ser escondidas. */
export interface TablePanels {
  scenes: boolean;
  tools: boolean;
  side: boolean;
  actions: boolean;
}

/** Efeito especial em exibição no mapa (transitório, não é salvo). */
export interface FxInstance {
  id: string;
  /** Desenho pronto, montado uma vez no lançamento (utils/effects.ts). */
  drawing: FxDrawing;
}

/** Efeito "na mão" do usuário depois de usar uma ação com efeito. */
export interface ArmedFx extends FxStyle {
  /** Nome da ação que o armou (exibido no aviso do mapa). */
  action: string;
}

/** Resultado de usar uma ação (para o aviso na tela). */
export interface ActionUse {
  author: string;
  roll: RollResult;
  /** A ação tinha efeito especial (agora armado no mouse). */
  armed: boolean;
  /** Estudos e Treinos que subiram de nível nesta rolagem (nomes das etiquetas). */
  levelUps: string[];
}

/** Mestre agindo como "o token selecionado" (muda a cada seleção). */
export const ACT_SELECTION = 'selection';

/** Tag de tema da ficha que uma ação pode usar no modificador. */
export interface SheetTagOption {
  id: string;
  text: string;
  /** Nível atual (1 a 6; defeitos de -1 a -6). */
  level: number;
  /** Nome do tema de origem (etiqueta de item: o nome do item). */
  theme: string;
  /** É um defeito (nível negativo). */
  flaw: boolean;
  /** Etiqueta de um item equipado (nível dela, sem nível = 1). */
  item?: boolean;
  /** Estudo ou treino: não muda o modificador (nível 0); só acumula SA ao rolar. */
  study?: boolean;
}

/** Modo da ferramenta Névoa. */
export type WallMode = 'line' | 'circle' | 'door' | 'edit' | 'erase';

/** Configuração atual do pincel (sessão). */
export interface Brush {
  color: string;
  width: number;
  opacity: number;
  /** Borracha: arrastar remove os traços tocados. */
  eraser: boolean;
}

/** Ação de desenho que pode ser desfeita (Ctrl+Z). */
type DrawAction = { kind: 'add'; strokeId: string } | { kind: 'erase'; removed: RemovedStroke[] };

/** Omit que preserva cada membro de uma união (ex.: Wall sem o id). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

const NO_TOKENS: TokenPlacement[] = [];
const NO_WALLS: Wall[] = [];
const NO_TABLE_ITEMS: TableItem[] = [];
const NO_STROKES: Stroke[] = [];
const NO_NOTES: MapNote[] = [];
const NO_MESSAGES: ChatMessage[] = [];
const NO_RESOLVED: ResolvedToken[] = [];
const NO_FOLDERS: SceneFolder[] = [];

/** Camada do mapa como a interface a exibe (0 = térreo, com o mapa da cena). */
export interface LevelView {
  id: string;
  index: number;
  name: string;
  blobId?: string;
}

/** Mesmos itens, na mesma ordem (igualdade de listas filtradas: evita recálculos). */
function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

/**
 * Estado da mesa aberta: cenas, arquivos (fichas, sons, automações),
 * tokens, ferramenta ativa e papel do usuário (mestre ou jogador).
 *
 * Fornecido no componente da mesa — cada mesa aberta tem sua instância.
 * Salva no IndexedDB com a chave "table-state:<id>".
 *
 * É uma FACHADA: os componentes chamam os métodos daqui, e toda alteração do estado
 * salvo vira um comando puro de `state/` aplicado por `dispatch` (gravação agrupada
 * com debounce de 300ms). Aqui ficam só o que não é puro: ids e horários novos,
 * arquivos (Blobs), o Worldbuild (NPCs do bestiário) e o estado da sessão.
 * As regras de permissão moram em `state/permissions.ts`.
 */
@Injectable()
export class TableSessionService extends SheetStore {
  private readonly auth = inject(AuthService);
  /** Bestiário: fichas base dos NPCs-referência (Worldbuild do usuário e Lore geral). */
  private readonly worldbuild = inject(WorldbuildService);
  private readonly loreGeneral = inject(LoreService);

  // --- Estado persistido ---------------------------------------------------
  private readonly state = signal<TableState>(EMPTY_STATE);
  private tableId = '';
  private saveTimer?: ReturnType<typeof setTimeout>;

  readonly loaded = signal(false);
  readonly scenes = computed(() => this.state().scenes);
  /** Arquivos da mesa; NPC-referência mostra sempre o nome atual da ficha base. */
  readonly entries = computed(() =>
    this.state().entries.map((e) => {
      const base = this.worldNpcOf(e);
      return base && base.name !== e.name ? { ...e, name: base.name } : e;
    }),
  );
  readonly activeScene = computed(() => this.scenes().find((s) => s.id === this.state().activeSceneId) ?? null);
  readonly entryById = computed(() => new Map(this.entries().map((e) => [e.id, e])));
  /** Volume mestre dos sons (0–1). */
  readonly soundMaster = computed(() => this.state().soundMaster ?? 1);
  /** Organização da aba Lore nesta mesa (pastas e ajustes locais). */
  readonly lore = computed(() => this.state().lore ?? EMPTY_LORE);

  // --- Vista isométrica e camadas do mapa (cena ativa) ---------------------

  /** Vista isométrica da cena ativa (mapa e tokens como numa mesa vista de lado). */
  readonly isometric = computed(() => this.activeScene()?.isometric ?? false);
  /** Camadas da cena: o térreo (mapa da cena) + as de cima, de baixo para cima. */
  readonly mapLevels = computed<LevelView[]>(() => {
    const scene = this.activeScene();
    if (!scene) return [];
    return [
      { id: 'ground', index: 0, name: 'Térreo', blobId: scene.blobId },
      ...(scene.levels ?? []).map((l, i) => ({ id: l.id, index: i + 1, name: l.name, blobId: l.blobId })),
    ];
  });
  readonly levelCount = computed(() => levelCountOf(this.activeScene()));
  /** Camada que os jogadores veem. */
  readonly playerLevel = computed(() => this.clampLevel(this.activeScene()?.playerLevel ?? 0));
  /** Camada que o mestre está olhando (só nesta sessão; começa na dos jogadores). */
  private readonly gmLevel = signal(0);
  /** Camada em foco na tela: o jogador vê sempre a camada liberada pelo mestre. */
  readonly currentLevel = computed(() => (this.role() === 'player' ? this.playerLevel() : this.clampLevel(this.gmLevel())));
  /** Painel de camadas aberto (barra de ferramentas). */
  readonly levelsOpen = signal(false);
  private readonly activeSceneId = computed(() => this.state().activeSceneId);

  /** Tokens colocados na cena ativa (mesma referência enquanto não mudam). */
  readonly tokens = computed(() => this.activeScene()?.tokens ?? NO_TOKENS);
  /** Tokens da cena ativa com as configurações efetivas. */
  readonly resolvedTokens = computed(() => {
    const byId = this.entryById();
    return this.tokens().flatMap((p) => this.resolveToken(p, byId) ?? []);
  });
  /** Quem está olhando a mesa (papel + conta), para as regras de `state/permissions.ts`. */
  private readonly viewer = computed<Viewer>(() => ({ role: this.role(), userId: this.auth.user()?.id }));

  /** Desenhos da cena ativa. */
  readonly drawings = computed(() => this.activeScene()?.drawings ?? NO_STROKES);
  /** Anotações da cena ativa. */
  readonly notes = computed(() => this.activeScene()?.notes ?? NO_NOTES);

  /**
   * Anotações exibidas: na visão de jogador somem as "só mestre" e, com névoa,
   * as que estão fora da área visível.
   */
  readonly visibleNotes = computed(() => visibleNotesFor(this.notes(), this.role(), this.fogView()));

  // --- Névoa de guerra e paredes (cena ativa) ------------------------------

  /** Paredes e portas da camada em foco (cada camada do mapa tem as suas). */
  readonly walls = computed(
    () => {
      const level = this.currentLevel();
      return (this.activeScene()?.walls ?? NO_WALLS).filter((w) => levelOf(w) === level);
    },
    { equal: sameItems },
  );
  readonly fogEnabled = computed(() => this.activeScene()?.fog?.enabled ?? false);
  private readonly wallSegments = computed(() => wallsToSegments(this.walls()));

  /**
   * Origens de visão (tokens com visão ligada), com o alcance em px do mapa.
   * Igualdade por valor: editar algo que não afeta a visão (ex.: volume de um som)
   * não dispara novo cálculo.
   */
  private readonly visionSources = computed(
    () => {
      const grid = this.activeScene()?.gridSize ?? 70;
      const level = this.currentLevel();
      // A névoa fica na camada em foco: enxergam os tokens dela
      return this.resolvedTokens()
        .filter((t) => t.vision.enabled && levelOf(t.placement) === level)
        .map((t) => ({ x: t.placement.x, y: t.placement.y, range: (t.vision.range / METERS_PER_SQUARE) * grid }));
    },
    { equal: (a, b) => a.length === b.length && a.every((s, i) => s.x === b[i].x && s.y === b[i].y && s.range === b[i].range) },
  );

  /** Áreas visíveis dos tokens (recalculadas só quando token, parede ou cena mudam). */
  readonly visionPolygons = computed(() => {
    if (!this.fogEnabled()) return [];
    const segments = this.wallSegments();
    return this.visionSources().map((s) => computeVisibilityPolygon(s, s.range, segments));
  });

  // --- Memória da névoa (áreas exploradas) ---------------------------------

  /**
   * Tamanho do mapa em px, informado pelo map-stage quando o mapa da cena termina de carregar
   * (dimensiona a memória da névoa). Guarda a cena a que pertence: enquanto o mapa de outra
   * cena carrega, a memória não é tocada (senão seria recriada com o tamanho errado).
   */
  readonly worldSize = signal<{ sceneId: string; w: number; h: number } | null>(null);
  /** Lembrar áreas já vistas (padrão: ligado). */
  readonly fogMemory = computed(() => this.activeScene()?.fog?.memory ?? true);
  /** Mesma referência enquanto a memória não muda (evita decodificar a cada edição da cena). */
  private readonly exploredData = computed(() => this.activeScene()?.explored);
  /** Áreas exploradas da cena ativa (null se a memória estiver desligada ou vazia). */
  readonly explored = computed(() => {
    const data = this.exploredData();
    return this.fogEnabled() && this.fogMemory() && data ? decodeMask(data) : null;
  });

  /** Portas da cena ativa. */
  readonly doors = computed(() => this.walls().filter((w): w is DoorWall => w.kind === 'door'));

  /** Portas exibidas: o jogador, com névoa, só vê as portas que algum token já enxerga. */
  readonly visibleDoors = computed(() => {
    const fog = this.fogView();
    return visibleDoorsFor(this.doors(), this.role(), fog, (d) => doorSeen(d.points, fog.polygons));
  });

  /** Névoa da cena ativa como as regras de `state/player-view.ts` a recebem. */
  private readonly fogView = computed<FogView>(() => ({
    enabled: this.fogEnabled(),
    polygons: this.visionPolygons(),
    explored: this.explored(),
  }));

  /** Visão de jogador com névoa: a área fora da visão fica escondida. */
  readonly playerFog = computed(() => this.fogEnabled() && this.role() === 'player');

  /**
   * Tokens exibidos, por camada: na visão de jogador com névoa, só os visíveis
   * (personagens sempre aparecem).
   */
  readonly tokensByLevel = computed(() => {
    const tokens = visibleTokensFor(this.resolvedTokens(), this.role(), this.fogView());
    const byLevel = new Map<number, ResolvedToken[]>();
    for (const t of tokens) {
      const level = this.clampLevel(levelOf(t.placement));
      byLevel.set(level, [...(byLevel.get(level) ?? []), t]);
    }
    return byLevel;
  });

  /** Tokens exibidos na camada em foco (interativos). */
  readonly visibleTokens = computed(() => this.tokensByLevel().get(this.currentLevel()) ?? NO_RESOLVED);

  // --- Estado da sessão (não persistido) -----------------------------------
  readonly tool = signal<TableTool>('select');
  readonly role = signal<TableRole>('gm');

  /** Troca o papel; no de jogador, sai da ferramenta Névoa (que é só do mestre). */
  setRole(role: TableRole): void {
    this.role.set(role);
    if (role === 'player' && this.tool() === 'fog') this.tool.set('select');
  }
  /** Token selecionado no mapa (anel azul). */
  readonly selectedTokenId = signal<string | null>(null);
  /** Modo da ferramenta Névoa: desenhar parede em linha, em círculo ou apagar. */
  readonly wallMode = signal<WallMode>('line');
  /** Mestre: mostrar paredes mesmo fora da ferramenta Névoa. */
  readonly showWallsAlways = signal(false);
  /** Parede selecionada no modo "Editar paredes". */
  readonly selectedWallId = signal<string | null>(null);
  /** Pincel da ferramenta Desenhar. */
  readonly brush = signal<Brush>({ color: BRUSH_COLORS[0], width: BRUSH_WIDTHS[1], opacity: 1, eraser: false });
  /** Pilha de desfazer dos desenhos, por cena (só nesta sessão). */
  private readonly drawHistory = new Map<string, DrawAction[]>();
  /** Paredes visíveis: durante a ferramenta Névoa ou, para o mestre, sempre (se ligado). */
  readonly wallsVisible = computed(
    () => this.tool() === 'fog' || (this.showWallsAlways() && this.role() === 'gm'),
  );

  /** Barras visíveis da mesa (todas podem ser escondidas). */
  readonly panels = signal<TablePanels>({ scenes: true, tools: true, side: true, actions: true });

  /** true quando todas as barras estão escondidas (modo imersivo). */
  readonly immersive = computed(() => Object.values(this.panels()).every((v) => !v));

  togglePanel(name: keyof TablePanels): void {
    this.panels.update((p) => ({ ...p, [name]: !p[name] }));
  }

  /** Esconde tudo ou, se já estiver tudo escondido, mostra tudo. */
  toggleImmersive(): void {
    const show = this.immersive();
    this.panels.set({ scenes: show, tools: show, side: show, actions: show });
  }

  // --- Ações (automações) e quem age ---------------------------------------

  /** Personagens da conta atual nesta mesa (sem dono = de qualquer um). */
  readonly myCharacters = computed(() => this.entries().filter((e) => e.kind === 'character' && this.ownsCharacter(e)));
  /** NPCs que o mestre autorizou a conta atual a controlar. */
  readonly myNpcs = computed(() => this.entries().filter((e) => e.kind === 'npc' && this.controlsNpc(e)));

  /**
   * Mestre: como quem está agindo na barra de ações (sessão).
   * ACT_SELECTION = segue o token selecionado; null = ações gerais; id = ficha fixa
   * (personagem ou NPC), que não muda ao clicar em outros tokens.
   */
  readonly gmActing = signal<string | null>(ACT_SELECTION);

  /**
   * Ficha que está agindo (dona das ações da barra inferior):
   * - Mestre: a ficha escolhida na barra ou, no modo "seguir seleção", a do token selecionado
   *   (sem seleção, ninguém = ações gerais).
   * - Jogador: o personagem dele ou NPC que controla, se selecionado; senão, o primeiro personagem dele.
   */
  readonly actor = computed<TableEntry | null>(() => {
    const id = this.selectedTokenId();
    const selected = id ? (this.resolvedTokenById(id)?.entry ?? null) : null;
    if (this.role() === 'gm') {
      const acting = this.gmActing();
      if (acting === ACT_SELECTION) return selected;
      return acting ? (this.entryById().get(acting) ?? null) : null;
    }
    if (selected?.kind === 'character' && this.ownsCharacter(selected)) return selected;
    if (selected?.kind === 'npc' && this.controlsNpc(selected)) return selected;
    return this.myCharacters()[0] ?? null;
  });

  // --- Permissões das fichas (provisórias: o papel ainda é escolhido na mesa) --
  // As regras moram em state/permissions.ts (puras, reaproveitáveis pelo servidor).

  /** O NPC foi liberado pelo mestre para a conta atual. */
  controlsNpc(entry: TableEntry): boolean {
    return rules.controlsNpc(entry, this.viewer());
  }

  /** Pode editar a ficha: o mestre sempre; NPC só o jogador autorizado; personagens seguem livres. */
  canEdit(entry: TableEntry): boolean {
    return rules.canEdit(entry, this.viewer());
  }

  /** O que a conta atual pode fazer com a ficha `sheetId` (regra em `rules.sheetAccess`). */
  sheetAccess(sheetId: string): SheetAccess {
    const placementId = tokenSheetPlacement(sheetId);
    return rules.sheetAccess(this.viewer(), this.sheetData(sheetId), placementId ? this.findPlacement(placementId) : undefined);
  }

  /** Pode abrir a ficha (ao menos uma parte visível). */
  canOpenSheet(sheetId: string): boolean {
    const access = this.sheetAccess(sheetId);
    return access.sheet || access.inventory;
  }

  /** Mestre: deixa a ficha ou o inventário de um token de NPC visível (só leitura) para os jogadores, ou não. */
  toggleTokenPublic(placementId: string, part: 'sheet' | 'inventory'): void {
    this.dispatch('toggleTokenPublic', { placementId, part });
  }

  /** Token colocado (em qualquer cena), sem resolver a ficha. */
  placementById(placementId: string): TokenPlacement | undefined {
    return this.findPlacement(placementId);
  }

  /**
   * Jogadores da mesa que podem receber o controle de um NPC: as contas donas de
   * personagens daqui, com os nomes dos personagens (ainda não há lista de convidados).
   */
  readonly players = computed(() => {
    const byUser = new Map<string, string[]>();
    for (const e of this.entries()) {
      if (e.kind === 'character' && e.ownerUserId) byUser.set(e.ownerUserId, [...(byUser.get(e.ownerUserId) ?? []), e.name]);
    }
    return [...byUser].map(([userId, characters]) => ({ userId, label: `Jogador de ${characters.join(', ')}` }));
  });

  /** Ações da barra inferior: as da ficha que está agindo (mestre sem seleção: as gerais). */
  readonly hotbar = computed(() => {
    const actor = this.actor();
    if (!actor && this.role() === 'player') return [];
    return this.automationsOf(actor?.id ?? null);
  });

  /** Automações de uma ficha (null = gerais do mestre). */
  automationsOf(ownerEntryId: string | null): TableEntry[] {
    return this.entries().filter((e) => e.kind === 'automation' && (e.ownerEntryId ?? null) === ownerEntryId);
  }

  /** O personagem é da conta atual? (personagem sem dono vale para qualquer um) */
  ownsCharacter(entry: TableEntry): boolean {
    return rules.ownsCharacter(entry, this.viewer());
  }

  /**
   * Ficha de quem age: com o token do NPC que age selecionado, a cópia daquele token
   * (as tags dele valem na rolagem); senão, a ficha da entrada.
   */
  readonly actorSheetId = computed<string | null>(() => {
    const actor = this.actor();
    if (!actor) return null;
    const selected = this.selectedTokenId();
    if (actor.kind === 'npc' && selected && this.findPlacement(selected)?.entryId === actor.id) return NPC_TOKEN_SHEET + selected;
    return actor.id;
  });

  /**
   * Usa uma ação: rola os dados, registra no chat em nome de quem agiu e, se a ação
   * tiver efeito especial, deixa o efeito "na mão" (ferramenta Efeitos) para o usuário lançar.
   * `sheetId`: ficha que agiu (ex.: "Usar" na ficha de um token); padrão = quem age na barra,
   * se for o dono da ação, ou o próprio dono.
   */
  useAction(entry: TableEntry, sheetId?: string): ActionUse {
    const config = entry.roll ?? DEFAULT_ROLL;
    const actorSheet = this.actor()?.id === entry.ownerEntryId ? this.actorSheetId() : null;
    const sheet = sheetId ?? actorSheet ?? entry.ownerEntryId;
    // O nível atual das tags da ficha que agiu entra no modificador
    const levels = this.tagLevelsOf(sheet);
    const roll: RollResult = { action: entry.name, icon: entry.icon ?? 'bolt', dice: config.dice, ...rollDice(config, Math.random, levels) };
    const author = (sheet && this.sheetData(sheet)?.name) ?? this.actor()?.name ?? this.userName();
    this.pushChat({ author, roll });
    // Estudos ligados à ação acumulam SA conforme o resultado
    const levelUps = this.trainStudies(sheet, (config.attributes ?? []).map(baseTagId), roll);

    if (entry.effect) {
      if (this.tool() !== 'fx') this.fxReturnTool = this.tool();
      this.armedFx.set({ ...entry.effect, action: entry.name });
      this.tool.set('fx');
    }
    return { author, roll, armed: !!entry.effect, levelUps };
  }

  /**
   * Rolagem básica (botão "Rolar dados" da barra de ações): não é uma ação salva — dado e
   * modificador (já com as tags escolhidas) valem só para esta rolagem. Vai para o chat em
   * nome da ficha `sheetId` (ou do mestre/conta, sem ficha). `studies`: estudos ligados a esta
   * rolagem (sem modificador; acumulam SA conforme o resultado).
   */
  quickRoll(
    dice: DiceKind,
    modifier: number,
    sheetId: string | null,
    itemModifier = 0,
    studies: readonly string[] = [],
  ): { author: string; roll: RollResult; levelUps: string[] } {
    // `itemModifier`: parte de `modifier` que vem dos itens equipados (exibida à parte no chat)
    const roll: RollResult = { action: 'Rolagem', icon: 'casino', dice, ...rollDice({ dice, modifier }), itemModifier };
    const author = (sheetId && this.sheetData(sheetId)?.name) || this.userName();
    this.pushChat({ author, roll });
    return { author, roll, levelUps: this.trainStudies(sheetId, studies, roll) };
  }

  // --- Chat ----------------------------------------------------------------

  readonly chat = computed(() => this.state().chat ?? NO_MESSAGES);

  /** Envia uma mensagem de texto em nome da conta atual. */
  sendChat(text: string): void {
    const trimmed = text.trim();
    if (trimmed) this.pushChat({ author: this.userName(), text: trimmed });
  }

  clearChat(): void {
    this.dispatch('clearChat', {});
  }

  private pushChat(message: Pick<ChatMessage, 'author' | 'text' | 'roll'>): void {
    const full: ChatMessage = { id: newId(), at: Date.now(), userId: this.auth.user()?.id ?? '', role: this.role(), ...message };
    this.dispatch('addChatMessage', { message: full });
  }

  private userName(): string {
    return this.role() === 'gm' ? 'Mestre' : (this.auth.user()?.name ?? 'Jogador');
  }

  // --- Efeitos especiais (transitórios) ------------------------------------

  /** Efeito escolhido na ferramenta Efeitos. */
  readonly fxStyle = signal<FxStyle>(DEFAULT_FX);
  /** Efeito de uma ação, esperando o usuário arrastar no mapa (vale para um lançamento). */
  readonly armedFx = signal<ArmedFx | null>(null);
  /** Efeitos em exibição no mapa. */
  readonly effects = signal<FxInstance[]>([]);
  /** Ferramenta para a qual voltar depois de lançar o efeito de uma ação. */
  private fxReturnTool: TableTool = 'select';

  /**
   * Lança um efeito de `from` até `to` (o da ação armada, ou o da ferramenta).
   * `scale` = zoom atual (tamanhos mínimos legíveis do desenho).
   */
  castFx(from: Point, to: Point, scale: number): void {
    const armed = this.armedFx();
    const { kind, color } = armed ?? this.fxStyle();
    const id = newId();
    const drawing = buildFx(kind, color, from, to, {
      uid: `fx-${id}`,
      scale,
      grid: this.activeScene()?.gridSize ?? 70,
      random: seededRandom(Math.floor(Math.random() * 2 ** 32)),
    });
    this.effects.update((list) => [...list, { id, drawing }]);
    setTimeout(() => this.effects.update((list) => list.filter((f) => f.id !== id)), drawing.duration + 100);
    if (armed) this.cancelArmedFx();
  }

  /** Desarma o efeito da ação e volta à ferramenta anterior. */
  cancelArmedFx(): void {
    if (!this.armedFx()) return;
    this.armedFx.set(null);
    this.tool.set(this.fxReturnTool);
  }

  constructor() {
    super();
    // Memória da névoa: tudo o que os tokens enxergam fica marcado como explorado.
    // (Salvar a máscara não altera a visão, então este efeito não se realimenta.)
    effect(() => {
      const polys = this.visionPolygons();
      const size = this.worldSize();
      if (polys.length && size && this.fogMemory()) untracked(() => this.markExplored(polys, size));
    });

    // Trocar de ferramenta à mão desarma o efeito de uma ação
    effect(() => {
      if (this.tool() !== 'fx') untracked(() => this.armedFx.set(null));
    });

    // Ao abrir outra cena, o mestre começa olhando a camada dos jogadores
    effect(() => {
      this.activeSceneId();
      untracked(() => this.gmLevel.set(this.activeScene()?.playerLevel ?? 0));
    });
  }

  // --- Carregamento --------------------------------------------------------

  async load(tableId: string): Promise<void> {
    this.flush();
    this.tableId = tableId;
    this.loaded.set(false);
    this.state.set(normalizeState(await this.storage.get<TableState>(this.key())));
    this.loaded.set(true);
  }

  // --- Cenas ---------------------------------------------------------------

  /** Cria uma cena (com mapa opcional) e a torna ativa. */
  async addScene(file?: File): Promise<Scene> {
    let blobId: string | undefined;
    if (file) {
      blobId = newId();
      await this.storage.set(`blob:${blobId}`, file);
    }
    const scene: Scene = {
      id: newId(),
      name: file?.name.replace(/\.[^.]+$/, '') ?? `Cena ${this.scenes().length + 1}`,
      blobId,
      gridSize: 70,
      showGrid: true,
      tokens: [],
      fog: { enabled: false },
      walls: [],
      drawings: [],
      notes: [],
    };
    this.dispatch('addScene', { scene });
    this.selectedTokenId.set(null);
    return scene;
  }

  /** Troca (ou define) o mapa de uma cena. */
  async setSceneMap(sceneId: string, file: File): Promise<void> {
    const old = this.scenes().find((s) => s.id === sceneId)?.blobId;
    const blobId = newId();
    await this.storage.set(`blob:${blobId}`, file);
    this.updateScene(sceneId, { blobId });
    if (old) this.storage.delete(`blob:${old}`);
  }

  updateScene(id: string, patch: Partial<Omit<Scene, 'id'>>): void {
    this.dispatch('updateScene', { sceneId: id, patch });
  }

  setActiveScene(id: string): void {
    this.dispatch('setActiveScene', { sceneId: id });
    this.selectedTokenId.set(null);
  }

  /** Exclui a cena e apaga os arquivos dos mapas dela (térreo e camadas). */
  removeScene(id: string): void {
    const scene = this.scenes().find((s) => s.id === id);
    this.dispatch('removeScene', { sceneId: id });
    for (const blobId of [scene?.blobId, ...(scene?.levels ?? []).map((l) => l.blobId)]) {
      if (blobId) this.storage.delete(`blob:${blobId}`);
    }
    // Imagens personalizadas dos inventários dos tokens de NPC da cena
    for (const token of scene?.tokens ?? []) this.deleteInventoryBlobs(token.sheet?.inventory);
  }

  /** Liga/desliga a vista isométrica da cena ativa. */
  toggleIsometric(): void {
    const scene = this.activeScene();
    if (!scene) return;
    this.updateScene(scene.id, { isometric: !scene.isometric });
    if (scene.isometric) this.levelsOpen.set(false);
  }

  // --- Pastas de cenas -----------------------------------------------------

  readonly sceneFolders = computed(() => this.state().sceneFolders ?? NO_FOLDERS);

  /** Cria uma pasta de cenas ("Nova pasta", "Nova pasta 2"…). */
  addSceneFolder(): SceneFolder {
    const folder: SceneFolder = { id: newId(), name: uniqueName('Nova pasta', this.sceneFolders().map((f) => f.name)) };
    this.dispatch('addSceneFolder', { folder });
    return folder;
  }

  renameSceneFolder(id: string, name: string): void {
    this.dispatch('renameSceneFolder', { folderId: id, name });
  }

  /** Exclui a pasta; as cenas dela continuam, fora de pastas. */
  removeSceneFolder(id: string): void {
    this.dispatch('removeSceneFolder', { folderId: id });
  }

  /** Move a cena para uma pasta (null = fora de pastas). */
  moveSceneToFolder(sceneId: string, folderId: string | null): void {
    this.dispatch('moveSceneToFolder', { sceneId, folderId });
  }

  // --- Camadas do mapa -----------------------------------------------------

  /** Mestre: passa a olhar outra camada (a seleção sai se o token não estiver nela). */
  viewLevel(level: number): void {
    const target = this.clampLevel(level);
    this.gmLevel.set(target);
    const selected = this.selectedTokenId();
    const token = selected ? this.findPlacement(selected) : undefined;
    if (token && levelOf(token) !== target) this.selectedTokenId.set(null);
  }

  /** Cria uma camada vazia ("ar") no topo e passa a olhá-la. */
  addLevel(): void {
    const scene = this.activeScene();
    if (!scene || this.levelCount() >= MAX_MAP_LEVELS) return;
    const level: MapLevel = { id: newId(), name: `Camada ${this.levelCount() + 1}` };
    this.dispatch('addLevel', { sceneId: scene.id, level });
    this.viewLevel(this.levelCount() - 1);
  }

  renameLevel(index: number, name: string): void {
    const scene = this.activeScene();
    if (scene) this.dispatch('renameLevel', { sceneId: scene.id, index, name });
  }

  /** Envia (ou troca) a imagem de uma camada. O térreo usa o mapa da cena. */
  async setLevelImage(index: number, file: File): Promise<void> {
    const scene = this.activeScene();
    if (!scene) return;
    if (index === 0) return this.setSceneMap(scene.id, file);
    const old = scene.levels?.[index - 1]?.blobId;
    const blobId = newId();
    await this.storage.set(`blob:${blobId}`, file);
    this.dispatch('setLevelImage', { sceneId: scene.id, index, blobId });
    if (old) this.storage.delete(`blob:${old}`);
  }

  /** Tira a imagem de uma camada de cima: ela vira "ar" (mostra a de baixo). */
  clearLevelImage(index: number): void {
    const scene = this.activeScene();
    const old = scene?.levels?.[index - 1]?.blobId;
    if (!scene || index < 1 || !old) return;
    this.dispatch('setLevelImage', { sceneId: scene.id, index });
    this.storage.delete(`blob:${old}`);
  }

  /** Exclui uma camada de cima; os tokens dela descem uma camada e as paredes dela são apagadas. */
  removeLevel(index: number): void {
    const scene = this.activeScene();
    const level = scene?.levels?.[index - 1];
    if (!scene || index < 1 || !level) return;
    this.dispatch('removeLevel', { sceneId: scene.id, index });
    this.gmLevel.update((n) => (n >= index ? n - 1 : n));
    if (level.blobId) this.storage.delete(`blob:${level.blobId}`);
  }

  /** Libera uma camada para os jogadores (é a que eles passam a ver). */
  showLevelToPlayers(index: number): void {
    const scene = this.activeScene();
    if (scene) this.dispatch('setPlayerLevel', { sceneId: scene.id, level: index });
  }

  /** Sobe/desce um token de camada; se for o selecionado, a vista do mestre o acompanha. */
  moveTokenLevel(placementId: string, delta: number): void {
    const placement = this.findPlacement(placementId);
    if (!placement) return;
    const target = this.clampLevel(levelOf(placement) + delta);
    if (target === levelOf(placement)) return;
    this.dispatch('updatePlacement', { placementId, patch: { level: target } });
    if (this.selectedTokenId() === placementId && this.role() === 'gm') this.gmLevel.set(target);
  }

  private clampLevel(level: number): number {
    return clampLevelIn(this.activeScene(), level);
  }

  // --- Arquivos da mesa ----------------------------------------------------

  /** Cria um arquivo vazio (ficha, NPC, automação). */
  addEntry(kind: TableEntryKind, extra: Partial<TableEntry> = {}): TableEntry {
    const count = this.entries().filter((e) => e.kind === kind).length + 1;
    const entry: TableEntry = {
      id: newId(),
      kind,
      name: `${TABLE_ENTRY_META[kind].label} ${count}`,
      createdAt: Date.now(),
      ...(kind === 'automation' && { icon: 'bolt', roll: { ...DEFAULT_ROLL } }),
      // O personagem pertence à conta de quem o criou
      ...(kind === 'character' && { ownerUserId: this.auth.user()?.id }),
      ...extra,
    };
    this.dispatch('addEntry', { entry });
    return entry;
  }

  /** Envia um arquivo de áudio e cria o som correspondente. */
  async uploadSound(file: File): Promise<TableEntry> {
    const blobId = newId();
    await this.storage.set(`blob:${blobId}`, file);
    return this.addEntry('sound', {
      name: file.name.replace(/\.[^.]+$/, ''),
      blobId,
      volume: DEFAULT_SOUND_VOLUME,
      loop: true,
    });
  }

  /** Define o volume mestre dos sons da mesa (0–1). */
  setSoundMaster(volume: number): void {
    this.dispatch('setSoundMaster', { volume });
  }

  updateEntry(id: string, patch: Partial<Omit<TableEntry, 'id' | 'kind'>>): void {
    this.dispatch('updateEntry', { entryId: id, patch });
  }

  /** Exclui o arquivo, as ações dele, os tokens dele em todas as cenas e os arquivos (áudio/imagem). */
  removeEntry(id: string): void {
    const entry = this.entryById().get(id);
    // Os tokens dele saem de todas as cenas (com as cópias de inventário)
    for (const sc of this.scenes()) {
      for (const token of sc.tokens ?? []) if (token.entryId === id) this.deleteInventoryBlobs(token.sheet?.inventory);
    }
    this.dispatch('removeEntry', { entryId: id });
    if (entry?.blobId) this.storage.delete(`blob:${entry.blobId}`);
    if (entry?.token?.blobId) this.storage.delete(`blob:${entry.token.blobId}`);
    // Imagens personalizadas dos itens do inventário
    this.deleteInventoryBlobs(entry?.sheet?.inventory);
  }

  getBlob(blobId: string): Promise<Blob | undefined> {
    return this.storage.get<Blob>(`blob:${blobId}`);
  }

  // --- NPCs do bestiário (referências) -------------------------------------

  /**
   * NPCs do bestiário por chave ("g:" Lore geral / "w:" Worldbuild + id). Igualdade por
   * referência dos itens: editar documentos ou outros itens do Worldbuild não recalcula
   * tokens e fichas da mesa — só mudanças nos próprios NPCs.
   */
  private readonly worldNpcMap = computed(
    () =>
      new Map([
        ...this.loreGeneral.worldNpcs().map((i) => [`g:${i.id}`, i] as const),
        ...this.worldbuild.worldNpcs().map((i) => [`w:${i.id}`, i] as const),
      ]),
    { equal: (a, b) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v) },
  );

  /** Ficha base no bestiário de um NPC-referência (undefined se não for referência ou se o original sumiu). */
  worldNpcOf(entry: TableEntry): WorldItem | undefined {
    if (!entry.worldNpcId) return undefined;
    return this.worldNpcMap().get(`${entry.worldNpcGlobal ? 'g' : 'w'}:${entry.worldNpcId}`);
  }

  /** Worldbuild ou Lore geral, conforme onde mora a ficha base do NPC. */
  private worldServiceOf(entry: TableEntry): WorldbuildService {
    return entry.worldNpcGlobal ? this.loreGeneral : this.worldbuild;
  }

  /** NPCs do bestiário (Lore geral + Worldbuild) que podem entrar na mesa. */
  readonly bestiary = computed(() =>
    [...this.worldNpcMap()].map(([key, item]) => ({ item, global: key.startsWith('g:') })),
  );

  /** Põe na mesa um NPC do bestiário (a entrada é só uma referência à ficha base). */
  addNpcReference(item: WorldItem, global: boolean): TableEntry {
    return this.addEntry('npc', { name: item.name, worldNpcId: item.id, ...(global && { worldNpcGlobal: true }) });
  }

  /** Cria um NPC novo no Worldbuild do usuário e já o põe na mesa. */
  createWorldNpc(): TableEntry {
    return this.addNpcReference(this.worldbuild.create('npc'), false);
  }

  // --- Fichas (SheetStore) -------------------------------------------------
  // O id da ficha é o id da entrada (personagem ou NPC). NPC-referência lê e grava
  // a ficha base no bestiário.

  /** Ficha da entrada com os valores padrão dos campos ausentes (sempre 3 temas e 1+ página). */
  sheetOf(entry: TableEntry): CharacterSheet {
    const base = this.worldNpcOf(entry);
    return base ? npcSheetOf(base) : normalizeSheet(entry.sheet);
  }

  sheetData(id: string): SheetData | null {
    const placementId = tokenSheetPlacement(id);
    if (placementId) return this.tokenSheetData(id, placementId);
    const entry = this.entryById().get(id);
    if (!entry || !hasSheet(entry.kind)) return null;
    const token = this.tokenOf(entry);
    const isBase = !!this.worldNpcOf(entry);
    return {
      id,
      kind: entry.kind === 'character' ? 'character' : 'npc',
      level: entry.kind === 'character' ? 'character' : isBase ? 'npc-base' : 'npc',
      name: entry.name,
      blobId: token.blobId,
      sheet: this.sheetOf(entry),
      bars: token.bars,
      tags: token.tags,
      entry,
    };
  }

  renameSheet(id: string, name: string): void {
    const trimmed = name.trim();
    const placementId = tokenSheetPlacement(id);
    if (placementId) {
      // Nome próprio do token (vazio = volta ao nome do NPC)
      this.dispatch('updatePlacement', { placementId, patch: { name: trimmed || undefined } });
      return;
    }
    const entry = this.entryById().get(id);
    if (!trimmed || !entry) return;
    const base = this.worldNpcOf(entry);
    if (base) this.worldServiceOf(entry).rename(base.id, trimmed);
    this.updateEntry(id, { name: trimmed });
  }

  /** A imagem é sempre a da ficha do NPC (a mesma em todos os tokens dele). */
  setSheetImage(id: string, file: File): Promise<void> {
    const placementId = tokenSheetPlacement(id);
    const entryId = placementId ? this.findPlacement(placementId)?.entryId : id;
    return entryId ? this.setTokenImage(entryId, file) : Promise.resolve();
  }

  /** Altera campos da ficha (NPC-referência: a ficha base no bestiário; token: a cópia dele). */
  updateSheet(id: string, patch: Partial<CharacterSheet>): void {
    const placementId = tokenSheetPlacement(id);
    if (placementId) {
      const current = this.sheetData(id)?.sheet;
      if (current) this.dispatch('updatePlacement', { placementId, patch: { sheet: { ...current, ...patch } } });
      return;
    }
    const entry = this.entryById().get(id);
    if (!entry) return;
    const base = this.worldNpcOf(entry);
    if (base) this.worldServiceOf(entry).update(base.id, { sheet: { ...npcSheetOf(base), ...patch } });
    else this.updateEntry(id, { sheet: { ...this.sheetOf(entry), ...patch } });
    // Item desequipado ou fora do inventário sai das ações que usavam as etiquetas dele
    if (patch.inventory) this.pruneItemTags(id);
  }

  updateStatus(id: string, patch: { bars?: TokenBar[]; tags?: TokenTag[] }): void {
    const placementId = tokenSheetPlacement(id);
    if (!placementId) return this.updateEntryToken(id, patch);
    // Token de NPC: barras e etiquetas são só dele
    this.dispatch('updatePlacement', { placementId, patch: { ...patch, ...(patch.bars && { bars: withStatusBars(patch.bars) }) } });
  }

  /** Ficha de um token de NPC: a cópia própria (ou, em tokens antigos, a do NPC até a primeira alteração). */
  private tokenSheetData(id: string, placementId: string): SheetData | null {
    const token = this.resolvedTokenById(placementId);
    if (!token || token.entry.kind !== 'npc') return null;
    return {
      id,
      kind: 'npc',
      level: 'npc-token',
      name: token.name,
      blobId: token.blobId,
      sheet: token.placement.sheet ? normalizeSheet(token.placement.sheet) : this.sheetOf(token.entry),
      bars: withStatusBars(token.bars),
      tags: token.tags,
      entry: token.entry,
    };
  }

  // --- Tags dos temas nas ações --------------------------------------------

  /** Tags e defeitos dos temas da ficha (vazio para ação geral ou ficha sem tags). */
  themeTagsOf(sheetId: string | undefined): SheetTagOption[] {
    const data = sheetId ? this.sheetData(sheetId) : null;
    if (!data) return [];
    return data.sheet.themes.flatMap((theme, i) => {
      const themeName = theme.name.trim() || `Tema ${i + 1}`;
      return [
        ...theme.tags.map((t) => ({ id: t.id, text: t.text.trim() || 'Tag sem nome', level: t.level, theme: themeName, flaw: false })),
        ...theme.flaws.map((t) => ({ id: t.id, text: t.text.trim() || 'Defeito sem nome', level: t.level, theme: themeName, flaw: true })),
      ];
    });
  }

  /**
   * Etiquetas dos itens equipados na ficha (com a personalização do inventário). O id é
   * por linha do inventário (`itemTagId`): desequipar ou tirar o item a tira das rolagens.
   */
  itemTagsOf(sheetId: string | undefined): SheetTagOption[] {
    const data = sheetId ? this.sheetData(sheetId) : null;
    if (!data) return [];
    const sources = { global: this.loreGeneral.byId(), own: this.worldbuild.byId(), table: this.tableItemById() };
    return data.sheet.inventory
      .filter((i) => i.equipped)
      .flatMap((i) => {
        const row = inventoryRow(i, sources);
        return row.tags.map((t) => ({
          id: itemTagId(i.id, t.id),
          text: t.text.trim() || 'Etiqueta sem nome',
          level: itemTagLevel(t),
          theme: row.name,
          flaw: false,
          item: true,
        }));
      });
  }

  /** Estudos e Treinos do personagem com etiqueta preenchida (ligados à rolagem sem modificador). */
  studyTagsOf(sheetId: string | undefined): SheetTagOption[] {
    const data = sheetId ? this.sheetData(sheetId) : null;
    if (data?.kind !== 'character') return [];
    return data.sheet.studies
      .filter((s) => s.text.trim())
      .map((s) => ({ id: s.id, text: s.text.trim(), level: 0, theme: 'Estudos e Treinos', flaw: false, study: true }));
  }

  /** Tudo o que pode ser ligado a uma rolagem: tags dos temas, etiquetas dos itens equipados e estudos. */
  rollTagsOf(sheetId: string | undefined): SheetTagOption[] {
    return [...this.themeTagsOf(sheetId), ...this.itemTagsOf(sheetId), ...this.studyTagsOf(sheetId)];
  }

  /**
   * Aplica uma rolagem aos estudos ligados a ela (`studyIds`): 12+ soma 1 SA, sucesso crítico
   * soma 2, falha crítica tira 1 (regra em `studyGain`/`trainStudy`). Quem alcança o SN sobe de nível: aviso no chat (mestre e jogadores veem) e o
   * nome volta para quem rolou mostrar a notificação.
   */
  private trainStudies(sheetId: string | null | undefined, studyIds: readonly string[], roll: RollResult): string[] {
    const data = sheetId ? this.sheetData(sheetId) : null;
    const ids = new Set(studyIds);
    const gain = studyGain(roll.total, roll.outcome);
    if (!sheetId || !data || !gain || !data.sheet.studies.some((s) => ids.has(s.id) && s.text.trim())) return [];
    const levelUps: string[] = [];
    const studies = data.sheet.studies.map((s) => {
      if (!ids.has(s.id) || !s.text.trim()) return s;
      const trained = trainStudy(s, gain);
      if (trained.leveledUp) levelUps.push(s.text.trim());
      return trained.study;
    });
    this.updateSheet(sheetId, { studies });
    if (levelUps.length) this.pushChat({ author: data.name, text: levelUpText(levelUps) });
    return levelUps;
  }

  /** Nível atual de cada tag do personagem (somado ao modificador das ações que a usam). */
  tagLevelsOf(entryId: string | undefined): TagLevels {
    return new Map(this.rollTagsOf(entryId).map((t) => [t.id, t.level]));
  }

  /**
   * Tira das ações da ficha as etiquetas de itens que não estão mais equipados (desequipou,
   * tirou do inventário, deu o item…). Só fichas de entrada: tokens de NPC compartilham as
   * ações do NPC, então a cópia de um token não mexe nelas.
   */
  private pruneItemTags(entryId: string): void {
    const valid = new Set(this.itemTagsOf(entryId).map((t) => t.id));
    for (const action of this.automationsOf(entryId)) {
      const attributes = action.roll?.attributes;
      const kept = attributes ? keepValidItemTags(attributes, valid) : null;
      if (action.roll && kept) this.updateEntry(action.id, { roll: { ...action.roll, attributes: kept.length ? kept : undefined } });
    }
  }

  /**
   * Fórmula da ação com o modificador efetivo (fixo + tags da ficha), ex.: "2d12+5".
   * `sheetId`: ficha cujas tags valem (padrão: a do dono da ação).
   */
  formulaOf(action: TableEntry, sheetId = action.ownerEntryId): string {
    return formatRoll(action.roll ?? DEFAULT_ROLL, this.tagLevelsOf(sheetId));
  }

  // --- Lojas (inventário de NPC com preços em Eiros) -----------------------

  /**
   * Personagem que compra nas lojas: o personagem da conta selecionado no mapa
   * ou, senão, o primeiro personagem da conta.
   */
  readonly buyer = computed<TableEntry | null>(() => {
    const actor = this.actor();
    if (actor?.kind === 'character' && this.ownsCharacter(actor)) return actor;
    return this.myCharacters()[0] ?? null;
  });

  /**
   * NPC derrotado: alguma barra de status zerada na ficha ou em qualquer token dele no mapa.
   * Os jogadores com acesso ao inventário podem lootear (pegar sem pagar).
   */
  isDefeated(sheetId: string): boolean {
    const data = this.sheetData(sheetId);
    if (data?.kind !== 'npc') return false;
    if (isDown(data.bars)) return true;
    const byId = this.entryById();
    return this.scenes().some((sc) =>
      (sc.tokens ?? []).some((p) => p.entryId === sheetId && isDown(this.resolveToken(p, byId)?.bars ?? [])),
    );
  }

  /** Pega uma unidade do inventário de um NPC derrotado, sem pagar. */
  lootItem(npcId: string, inventoryId: string, toId: string): Promise<boolean> {
    return this.isDefeated(npcId) ? this.transferItem(npcId, inventoryId, toId) : Promise.resolve(false);
  }

  /** Compra uma unidade da loja de um NPC com os Eiros do comprador (false = não está à venda ou faltam Eiros). */
  buyItem(shopId: string, inventoryId: string, buyerId: string): Promise<boolean> {
    const price = this.inventoryOf(shopId).find((i) => i.id === inventoryId)?.price;
    return price === undefined ? Promise.resolve(false) : this.transferItem(shopId, inventoryId, buyerId, price);
  }

  /**
   * Passa uma unidade de um item de um inventário para outro (compra, loot ou "Dar para"),
   * com a personalização (nome, etiquetas, imagem) e sem o preço. `cost` sai dos Eiros de quem recebe.
   * - Origem NPC (loja): a quantidade baixa 1 e a linha fica, mesmo em 0.
   * - Origem personagem: a linha some ao zerar (a imagem personalizada vai junto);
   *   enquanto sobrar unidade, a imagem é duplicada para cada inventário cuidar da sua.
   */
  async transferItem(fromId: string, inventoryId: string, toId: string, cost = 0): Promise<boolean> {
    const from = this.sheetData(fromId);
    const item = this.inventoryOf(fromId).find((i) => i.id === inventoryId);
    const to = this.sheetData(toId);
    if (!from || !to || !item || fromId === toId || quantityOf(item) < 1) return false;
    if (cost > 0 && to.sheet.eiros < cost) return false;

    const keepEmpty = from.kind === 'npc';
    const leavesList = !keepEmpty && quantityOf(item) === 1;
    let blobId = item.blobId;
    if (blobId && !leavesList) {
      const blob = await this.storage.get<Blob>(`blob:${blobId}`);
      blobId = blob ? newId() : undefined;
      if (blob && blobId) await this.storage.set(`blob:${blobId}`, blob);
    }

    // Relê os inventários depois do await (podem ter mudado no meio)
    const taken = takeOne(this.inventoryOf(fromId), inventoryId, keepEmpty);
    const unit: InventoryEntry = { ...item, blobId };
    if (!blobId) delete unit.blobId;
    this.updateSheet(fromId, { inventory: taken.list });
    const receiver = this.sheetData(toId);
    this.updateSheet(toId, {
      inventory: addOne(this.inventoryOf(toId), unit, newId),
      ...(cost > 0 && receiver && { eiros: receiver.sheet.eiros - cost }),
    });
    return true;
  }

  // --- Lore da mesa (pastas e ajustes locais) -----------------------------
  // Nada aqui altera ou apaga os itens do worldbuild / Lore geral.

  /** Nome do item da lore nesta mesa (o local, se renomeado aqui). */
  loreName(item: { id: string; name: string }): string {
    return this.lore().items[item.id]?.name ?? item.name;
  }

  /** Cria uma pasta na aba Lore ("Nova pasta", "Nova pasta 2"…). */
  addLoreFolder(): LoreFolder {
    const folder: LoreFolder = { id: newId(), name: uniqueName('Nova pasta', this.lore().folders.map((f) => f.name)) };
    this.dispatch('addLoreFolder', { folder });
    return folder;
  }

  renameLoreFolder(id: string, name: string): void {
    this.dispatch('renameLoreFolder', { folderId: id, name });
  }

  /** Mestre: revela ou esconde dos jogadores tudo o que está na pasta. */
  toggleLoreFolderPublic(id: string): void {
    this.dispatch('toggleLoreFolderPublic', { folderId: id });
  }

  /** O jogador pode ver este item da lore? (regra em `rules.canSeeLoreItem`; o mestre vê tudo) */
  canSeeLoreItem(itemId: string): boolean {
    return rules.canSeeLoreItem(this.lore(), itemId, this.tableItemById().has(itemId), this.viewer());
  }

  /** Exclui a pasta da mesa; os itens dela voltam para a raiz da aba Lore. */
  removeLoreFolder(id: string): void {
    this.dispatch('removeLoreFolder', { folderId: id });
  }

  /** Renomeia o item só nesta mesa (nome vazio ou igual ao original volta ao original). */
  renameLoreItem(item: { id: string; name: string }, name: string): void {
    this.dispatch('renameLoreItem', { itemId: item.id, originalName: item.name, name });
  }

  /** Move o item para uma pasta da mesa (null = raiz). */
  moveLoreItem(itemId: string, folderId: string | null): void {
    this.dispatch('moveLoreItem', { itemId, folderId });
  }

  /** Remove o item desta mesa (o original continua no worldbuild / Lore geral). */
  hideLoreItem(itemId: string): void {
    this.dispatch('hideLoreItem', { itemId });
  }

  /** Traz de volta todos os itens removidos desta mesa. */
  restoreLoreItems(): void {
    this.dispatch('restoreLoreItems', {});
  }

  // --- Itens da mesa (criados por jogadores, fora do Worldbuild) -----------

  readonly tableItems = computed(() => this.state().items ?? NO_TABLE_ITEMS);
  readonly tableItemById = computed(() => new Map(this.tableItems().map((i) => [i.id, i])));

  /** Cria um item só nesta mesa (o jogador não grava no Worldbuild de ninguém). Aparece na aba Lore. */
  createTableItem(name = ''): TableItem {
    const item: TableItem = {
      id: newId(),
      name: name.trim() || 'Novo item',
      tags: [],
      ownerUserId: this.auth.user()?.id,
      createdAt: Date.now(),
    };
    this.dispatch('addTableItem', { item });
    return item;
  }

  /** Quem criou o item da mesa (e o mestre) edita o original; os demais só a cópia do inventário. */
  canEditTableItem(itemId: string): boolean {
    return rules.canEditTableItem(this.tableItemById().get(itemId), this.viewer());
  }

  updateTableItem(itemId: string, patch: Partial<Pick<TableItem, 'name' | 'tags' | 'description'>>): void {
    this.dispatch('updateTableItem', { itemId, patch });
  }

  /** Troca a imagem do item da mesa (apaga a anterior). */
  async setTableItemImage(itemId: string, file: File): Promise<void> {
    const old = this.tableItemById().get(itemId)?.blobId;
    const blobId = newId();
    await this.storage.set(`blob:${blobId}`, file);
    this.dispatch('updateTableItem', { itemId, patch: { blobId } });
    if (old) this.storage.delete(`blob:${old}`);
  }

  // --- Tokens: regra de vínculo --------------------------------------------

  /** Configuração do token na ficha (NPC-referência: a do bestiário; senão, o padrão do tipo). */
  tokenOf(entry: TableEntry): TokenSettings {
    const base = this.worldNpcOf(entry);
    if (base) return npcTokenOf(base);
    return entry.token ?? defaultToken(entry.kind);
  }

  /** Configurações efetivas de um token colocado (regra de vínculo em `state/tokens.ts`). */
  resolveToken(placement: TokenPlacement, byId = this.entryById()): ResolvedToken | null {
    const entry = byId.get(placement.entryId);
    return entry ? resolveToken(placement, entry, this.tokenOf(entry)) : null;
  }

  /** Token colocado (em qualquer cena) com as configurações efetivas. */
  resolvedTokenById(placementId: string): ResolvedToken | null {
    const placement = this.findPlacement(placementId);
    return placement ? this.resolveToken(placement) : null;
  }

  /**
   * Altera um token colocado respeitando a regra de vínculo:
   * personagem grava na ficha (vale para todos os tokens dele);
   * NPC grava só neste token (inclusive a visão). A velocidade é sempre da ficha.
   */
  updateToken(placementId: string, patch: TokenPatch): void {
    const placement = this.findPlacement(placementId);
    const entry = placement && this.entryById().get(placement.entryId);
    if (!placement || !entry) return;

    const split = splitTokenPatch(entry.kind, patch);
    if (split.settings) this.updateEntryToken(entry.id, split.settings);
    if (split.placement) this.dispatch('updatePlacement', { placementId, patch: split.placement });
  }

  /** NPC: grava tamanho, visão, barras e etiquetas deste token como padrão da ficha (próximos tokens copiam). */
  saveTokenAsDefault(placementId: string): void {
    const token = this.resolvedTokenById(placementId);
    if (!token) return;
    this.updateEntryToken(token.entry.id, {
      size: token.size,
      vision: { ...token.vision },
      bars: token.bars.map((b) => ({ ...b })),
      tags: token.tags.map((t) => ({ ...t })),
    });
  }

  /**
   * Altera a configuração de token da ficha (personagem/NPC mantém sempre as barras de status).
   * NPC-referência: grava no token padrão do NPC no bestiário.
   */
  updateEntryToken(entryId: string, patch: Partial<TokenSettings>): void {
    const entry = this.entryById().get(entryId);
    if (!entry) return;
    const token = { ...this.tokenOf(entry), ...patch };
    if (hasSheet(entry.kind)) token.bars = withStatusBars(token.bars);
    const base = this.worldNpcOf(entry);
    if (base) this.worldServiceOf(entry).update(base.id, { token });
    else this.updateEntry(entryId, { token });
  }

  /** Troca a imagem do token da ficha e apaga a anterior. */
  async setTokenImage(entryId: string, file: File): Promise<void> {
    const entry = this.entryById().get(entryId);
    if (!entry) return;
    const blobId = newId();
    await this.storage.set(`blob:${blobId}`, file);
    const old = this.tokenOf(entry).blobId;
    this.updateEntryToken(entryId, { blobId });
    if (old) this.storage.delete(`blob:${old}`);
  }

  // --- Tokens no mapa ------------------------------------------------------

  /** Coloca o token de um personagem/NPC na cena ativa (centro em `p`). */
  placeToken(entryId: string, p: Point): TokenPlacement | null {
    const entry = this.entryById().get(entryId);
    const scene = this.activeScene();
    if (!entry || !scene || (entry.kind !== 'character' && entry.kind !== 'npc')) return null;

    const sheet = this.tokenOf(entry);
    const placement: TokenPlacement = {
      id: newId(),
      entryId,
      x: p.x,
      y: p.y,
      // Entra na camada em foco
      ...(this.currentLevel() > 0 && { level: this.currentLevel() }),
      // NPC: cada token colocado é independente (cópia do token padrão e da ficha)
      ...(entry.kind === 'npc' && {
        size: sheet.size,
        vision: { ...sheet.vision },
        bars: sheet.bars.map((b) => ({ ...b })),
        tags: sheet.tags.map((t) => ({ ...t })),
        sheet: structuredClone(this.sheetOf(entry)),
      }),
    };
    this.dispatch('placeToken', { sceneId: scene.id, placement });
    this.selectedTokenId.set(placement.id);
    // As imagens personalizadas do inventário copiado ganham cópias próprias
    if (placement.sheet?.inventory.some((i) => i.blobId)) void this.cloneTokenInventoryBlobs(placement.id);
    return placement;
  }

  /** Duplica as imagens do inventário de um token recém-colocado (para não apagar as do original). */
  private async cloneTokenInventoryBlobs(placementId: string): Promise<void> {
    const inventory = this.findPlacement(placementId)?.sheet?.inventory;
    if (!inventory) return;
    const cloned = await this.cloneInventoryBlobs(inventory);
    const sheet = this.findPlacement(placementId)?.sheet;
    // Se o token sumiu no meio, apaga as cópias; senão, troca só as imagens (ids iguais)
    if (!sheet) return this.deleteInventoryBlobs(cloned.filter((c, i) => c.blobId !== inventory[i].blobId));
    const byId = new Map(cloned.map((c) => [c.id, c.blobId]));
    this.dispatch('updatePlacement', {
      placementId,
      patch: { sheet: { ...sheet, inventory: sheet.inventory.map((i) => (byId.has(i.id) ? { ...i, blobId: byId.get(i.id) } : i)) } },
    });
  }

  moveToken(placementId: string, p: Point): void {
    this.dispatch('moveToken', { placementId, x: p.x, y: p.y });
  }

  /** Remove o token do mapa (a ficha continua; a cópia do NPC, com o inventário dela, some). */
  removeToken(placementId: string): void {
    this.deleteInventoryBlobs(this.findPlacement(placementId)?.sheet?.inventory);
    this.dispatch('removeToken', { placementId });
    if (this.selectedTokenId() === placementId) this.selectedTokenId.set(null);
  }

  // --- Névoa e paredes -----------------------------------------------------

  /** Liga/desliga a névoa de guerra na cena ativa. */
  setFog(enabled: boolean): void {
    const sceneId = this.activeSceneId();
    if (sceneId) this.dispatch('setFog', { sceneId, enabled });
  }

  /** Adiciona uma parede à cena ativa, na camada em foco. */
  addWall(wall: DistributiveOmit<Wall, 'id'>): void {
    const sceneId = this.activeSceneId();
    const level = this.currentLevel();
    const created = { ...wall, id: newId(), ...(level > 0 && { level }) } as Wall;
    if (sceneId) this.dispatch('addWall', { sceneId, wall: created });
  }

  /** Substitui uma parede da cena ativa (mover parede ou ponto). */
  updateWall(wall: Wall): void {
    const sceneId = this.activeSceneId();
    if (sceneId) this.dispatch('updateWall', { sceneId, wall });
  }

  /** Liga/desliga a memória da névoa (lembrar áreas exploradas) na cena ativa. */
  setFogMemory(memory: boolean): void {
    const sceneId = this.activeSceneId();
    if (sceneId) this.dispatch('setFogMemory', { sceneId, memory });
  }

  /** Esquece as áreas exploradas da cena ativa. */
  clearExplored(): void {
    const sceneId = this.activeSceneId();
    if (sceneId) this.dispatch('setExplored', { sceneId });
  }

  /** Soma as áreas visíveis à memória da cena (só grava se algo novo foi visto). */
  private markExplored(polygons: Point[][], size: { sceneId: string; w: number; h: number }): void {
    const scene = this.activeScene();
    if (!scene || scene.id !== size.sceneId) return;
    const current = scene.explored ? decodeMask(scene.explored) : null;
    // Mapa trocado (outro tamanho): a memória recomeça
    const mask = current && maskFits(current, size.w, size.h) ? current : createMask(size.w, size.h);
    if (markPolygons(mask, polygons) || mask !== current) this.dispatch('setExplored', { sceneId: scene.id, explored: encodeMask(mask) });
  }

  /** Abre ou fecha uma porta (a visão é recalculada automaticamente). */
  toggleDoor(doorId: string): void {
    const sceneId = this.activeSceneId();
    if (sceneId && this.doors().some((d) => d.id === doorId)) this.dispatch('toggleDoor', { sceneId, doorId });
  }

  removeWall(wallId: string): void {
    const sceneId = this.activeSceneId();
    if (sceneId) this.dispatch('removeWall', { sceneId, wallId });
    if (this.selectedWallId() === wallId) this.selectedWallId.set(null);
  }

  // --- Desenhos (pincel) ---------------------------------------------------

  /** Adiciona um traço à cena ativa. */
  addStroke(stroke: Omit<Stroke, 'id'>): void {
    const sceneId = this.activeSceneId();
    if (!sceneId) return;
    const created: Stroke = { ...stroke, id: newId() };
    this.dispatch('addStroke', { sceneId, stroke: created });
    this.pushDrawAction(sceneId, { kind: 'add', strokeId: created.id });
  }

  /** Remove traços da cena ativa (borracha ou limpar tudo) — pode ser desfeito. */
  eraseStrokes(ids: string[]): void {
    const scene = this.activeScene();
    const removed = strokesToErase(scene?.drawings ?? [], ids);
    if (!scene || !removed.length) return;
    this.dispatch('eraseStrokes', { sceneId: scene.id, strokeIds: ids });
    this.pushDrawAction(scene.id, { kind: 'erase', removed });
  }

  clearDrawings(): void {
    this.eraseStrokes(this.drawings().map((s) => s.id));
  }

  /** Desfaz a última ação de desenho da cena ativa. Retorna false se não havia nada. */
  undoDrawing(): boolean {
    const scene = this.activeScene();
    const action = scene && this.drawHistory.get(scene.id)?.pop();
    if (!scene || !action) return false;

    if (action.kind === 'add') this.dispatch('eraseStrokes', { sceneId: scene.id, strokeIds: [action.strokeId] });
    // Recoloca os traços apagados nas posições originais (mantém a ordem de sobreposição)
    else this.dispatch('restoreStrokes', { sceneId: scene.id, removed: action.removed });
    return true;
  }

  private pushDrawAction(sceneId: string, action: DrawAction): void {
    const stack = this.drawHistory.get(sceneId) ?? [];
    stack.push(action);
    // Limite simples para não crescer sem fim numa sessão longa
    if (stack.length > 100) stack.shift();
    this.drawHistory.set(sceneId, stack);
  }

  // --- Anotações -----------------------------------------------------------

  /** Cria uma anotação vazia na cena ativa. */
  addNote(p: Point): MapNote | null {
    const sceneId = this.activeSceneId();
    if (!sceneId) return null;
    const note: MapNote = { id: newId(), x: p.x, y: p.y, title: '', text: '', color: NOTE_COLORS[0], gmOnly: false };
    this.dispatch('addNote', { sceneId, note });
    return note;
  }

  updateNote(noteId: string, patch: Partial<Omit<MapNote, 'id'>>): void {
    const sceneId = this.activeSceneId();
    if (sceneId) this.dispatch('updateNote', { sceneId, noteId, patch });
  }

  moveNote(noteId: string, p: Point): void {
    this.updateNote(noteId, { x: p.x, y: p.y });
  }

  removeNote(noteId: string): void {
    const sceneId = this.activeSceneId();
    if (sceneId) this.dispatch('removeNote', { sceneId, noteId });
  }

  private findPlacement(placementId: string): TokenPlacement | undefined {
    return findPlacement(this.scenes(), placementId);
  }

  // --- Comandos e persistência ---------------------------------------------

  private key(): string {
    return `table-state:${this.tableId}`;
  }

  /**
   * Único ponto de alteração do estado salvo: aplica o comando puro (state/commands.ts)
   * e agenda a gravação (alterações seguidas viram uma só). No multiplayer, é aqui que
   * o comando também será enviado ao servidor.
   */
  private dispatch<K extends TableCommandType>(type: K, payload: TableCommandPayload<K>): void {
    const next = applyCommand(this.state(), { type, payload } as Parameters<typeof applyCommand>[1]);
    if (next === this.state()) return;
    this.state.set(next);
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 300);
  }

  /** Grava imediatamente o que estiver pendente. */
  flush(): void {
    clearTimeout(this.saveTimer);
    if (this.loaded() && this.tableId) this.storage.set(this.key(), this.state());
  }
}
