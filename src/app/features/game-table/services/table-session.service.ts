import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Point } from '../../../core/models/geometry.model';
import { WorldItem, npcSheetOf, npcTokenOf } from '../../../core/models/world-item.model';
import { WorldbuildService } from '../../worldbuild/services/worldbuild.service';
import {
  SoundPlay, FxKind, BRUSH_COLORS,
  BRUSH_WIDTHS,
  ChatMessage,
  DEFAULT_FX,
  DEFAULT_ROLL,
  DiceKind,
  DEFAULT_SOUND_VOLUME,
  DoorWall,
  DroppedItem,
  FixedFx,
  FxStyle,
  ItemDragData,
  MANA_BAR,
  MAX_MAP_LEVELS,
  RollConfig,
  MapLevel,
  SceneFolder,
  RollResult,
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
import { LocalFileStore } from '../../../core/services/file-store';
import { ServerApiService } from '../../../core/services/server-api.service';
import { ServerFileStore } from '../../../core/services/server-file-store';
import { StorageService } from '../../../core/services/storage.service';
import { newId } from '../../../core/utils/id';
import {
  TagLevels,
  baseTagId,
  formatRoll,
  keepValidItemTags,
  levelUpText,
  manaCost,
  rollDice,
  rollUsesTags,
  studyGain,
  trainStudy,
  withPowers,
} from '../utils/dice';
import { inventoryRow, itemTagId, itemTagLevel, quantityOf } from '../utils/inventory';
import { SheetData, SheetStore } from '../../../core/services/sheet-store';
import { FxDrawing, buildFx, seededRandom } from '../utils/effects';
import { createMask, decodeMask, encodeMask, markPolygons, maskFits } from '../utils/fog-memory';
import { Segment, doorSeen, wallsToSegments } from '../utils/visibility';
import { movePathBlocked } from '../utils/walls';
import {
  FogView,
  sameVisionSources,
  visibleDoorsFor,
  visibleDropsFor,
  visibleNotesFor,
  visibleTokensFor,
  visionPolygonsOf,
  visionSourcesOf,
} from '../state/player-view';
import { findDrop } from '../state/drops';
import { inventoryHolder, unitNeedsImageCopy } from '../state/inventory';
import { worldItemRefs } from '../state/lore';
import { NO_SELECTION, TokenSelection, keepOnly, selectMany, selectOne, toggleInSelection, without } from '../utils/selection';
import { TableCommand, TableCommandPayload, TableCommandType, applyCommand } from '../state/commands';
import {
  SyncState,
  ackCommand,
  burstKey,
  localCommand,
  mergeBurst,
  rejectCommand,
  remoteCommand,
  replaceState,
  squashPending,
  startSync,
} from '../state/sync';
import { RoomIdentity, RoomMessage, RoomRoll, RoomEvent, RoomStatus, TableRoom } from './table-room';
import { RemovedStroke, strokesToErase } from '../state/drawings';
import { findPlacement, levelOf, tokenSheetPlacement, uniqueName } from '../state/helpers';
import { clampLevelIn, levelCountOf } from '../state/levels';
import * as rules from '../state/permissions';
import { SheetAccess, Viewer } from '../state/permissions';
import { EMPTY_LORE, EMPTY_STATE, normalizeState } from '../state/table-state';
import { npcAbilitiesOf, toStoredAbility, withAbility, withoutAbility } from '../state/npc-abilities';
import { ResolvedToken, TokenPatch, copyPlacement, resolveToken, splitTokenPatch } from '../state/tokens';

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

/** Rolagem recusada antes de rolar (ex.: falta Mana para as tags mágicas). */
export interface RollRefused {
  refused: string;
}

/** Mesa online: a rolagem foi enviada ao servidor; o resultado chega no chat (e em `serverRoll`). */
export interface RollSent {
  sent: true;
  /** A ação tinha efeito especial (agora armado no mouse). */
  armed: boolean;
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
  /** Tag mágica: vale o Poder escolhido (1 até o nível) e gasta essa Mana (Espírito). */
  magic?: boolean;
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

/** Intervalo mínimo entre envios de uma rajada (arrastar, WASD, memória da névoa) na mesa online. */
const BURST_MS = 100;
const NO_TOKENS: TokenPlacement[] = [];
const NO_PLAYING: SoundPlay[] = [];
const NO_WALLS: Wall[] = [];
const NO_TABLE_ITEMS: TableItem[] = [];
const NO_STROKES: Stroke[] = [];
const NO_NOTES: MapNote[] = [];
const NO_MESSAGES: ChatMessage[] = [];
const NO_RESOLVED: ResolvedToken[] = [];
const NO_FOLDERS: SceneFolder[] = [];
const NO_DROPS: DroppedItem[] = [];
const NO_FIXED_FX: FixedFx[] = [];

/** Personagem ou token de NPC que pode pegar um item do chão. */
export interface PickupCandidate {
  /** Id da ficha que recebe o item (personagem: id da entrada; token de NPC: "npc:<id do token>"). */
  sheetId: string;
  name: string;
  blobId?: string;
  /** Distância do token até o item, em quadrados (ausente = sem token na cena/camada). */
  distance?: number;
}

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
  private readonly storage = inject(StorageService);
  private readonly api = inject(ServerApiService);
  /** Arquivos no navegador (mesa local e Worldbuild); na mesa online, `files` passa a ser o servidor. */
  private readonly localFiles = inject(LocalFileStore);
  /** Mundo da mesa: bestiário (fichas base dos NPCs-referência), itens e raças. */
  private readonly worldbuild = inject(WorldbuildService);

  // --- Estado persistido ---------------------------------------------------
  private readonly state = signal<TableState>(EMPTY_STATE);
  private tableId = '';
  private saveTimer?: ReturnType<typeof setTimeout>;

  readonly loaded = signal(false);
  readonly scenes = computed(() => this.state().scenes);

  // --- Mesa online (servidor) ---------------------------------------------
  // Sem sala = mesa local (IndexedDB). Com sala, o estado vem do servidor e cada comando vai para
  // ele (reconciliação pura em state/sync.ts); o papel vem da conta (dono = mestre).
  private room: TableRoom | null = null;
  private sync: SyncState | null = null;
  /** Rajadas ainda não enviadas (por `burstKey`): vão juntas, só com o último valor, a cada `BURST_MS`. */
  private readonly bursts = new Map<string, { seqs: number[]; commands: TableCommand[] }>();
  private burstTimer?: ReturnType<typeof setTimeout>;
  /** Conta conectada e papel dela, segundo o servidor (null = mesa local). */
  readonly online = signal<RoomIdentity | null>(null);
  readonly roomStatus = signal<RoomStatus>('offline');
  /** Motivo de a conexão ter caído de vez (sessão encerrada, mesa excluída…). */
  readonly roomProblem = signal('');
  /** Polígonos de visão calculados pelo servidor (jogador com névoa: ele não recebe as paredes). */
  private readonly serverVision = signal<Point[][] | null>(null);
  /** Aviso do servidor para a página mostrar (comando recusado, erro). */
  readonly roomNotice = signal<{ text: string } | null>(null);
  /** Última rolagem feita pelo servidor a pedido desta conta (a página mostra o resultado). */
  readonly serverRoll = signal<ChatMessage | null>(null);
  /** Conta atual: a do servidor na mesa online; a local, fora dela. */
  private readonly me = computed(() => {
    const online = this.online();
    return online ? { id: online.userId, name: online.name } : this.auth.user();
  });
  /**
   * Habilidades dos NPCs-referência: moram no NPC do mundo e aparecem aqui como ações
   * do NPC (valem em todas as mesas do mundo).
   */
  private readonly npcAbilities = computed(() => npcAbilitiesOf(this.state().entries, (e) => this.worldNpcOf(e)));
  /** NPC do mundo onde mora cada habilidade (id da ação → id do NPC). */
  private readonly abilityHome = computed(() => new Map(this.npcAbilities().map((a) => [a.entry.id, a.npcId])));

  /**
   * Arquivos da mesa; NPC-referência mostra sempre o nome atual da ficha base, e as
   * habilidades dele (do mundo) entram como ações.
   */
  readonly entries = computed(() => [
    ...this.state().entries.map((e) => {
      const base = this.worldNpcOf(e);
      return base && base.name !== e.name ? { ...e, name: base.name } : e;
    }),
    ...this.npcAbilities().map((a) => a.entry),
  ]);
  readonly activeScene = computed(() => this.scenes().find((s) => s.id === this.state().activeSceneId) ?? null);
  readonly entryById = computed(() => new Map(this.entries().map((e) => [e.id, e])));
  /** Volume mestre dos sons (0–1). */
  readonly soundMaster = computed(() => this.state().soundMaster ?? 1);
  /** Mesa online: sons tocando para todos (só muda quando a lista muda de verdade). */
  readonly playingSounds = computed(
    () => {
      const entries = this.state().entries;
      return this.online() ? (this.state().playing ?? []).filter((p) => entries.some((e) => e.id === p.entryId)) : NO_PLAYING;
    },
    { equal: (a, b) => a.length === b.length && a.every((p, i) => p.entryId === b[i].entryId && p.startedAt === b[i].startedAt) },
  );
  /** Aba Lore nesta mesa: as pastas do mundo reveladas aos jogadores. */
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
  private readonly viewer = computed<Viewer>(() => ({ role: this.role(), userId: this.me()?.id, shared: !!this.online() }));

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
    // A névoa fica na camada em foco: enxergam os tokens dela
    () => visionSourcesOf(this.resolvedTokens(), this.currentLevel(), this.activeScene()?.gridSize ?? 70),
    { equal: sameVisionSources },
  );

  /**
   * Áreas visíveis dos tokens (recalculadas só quando token, parede ou cena mudam). Jogador
   * na mesa online: vêm prontas do servidor, que não envia as paredes a ele.
   */
  readonly visionPolygons = computed(() => {
    if (!this.fogEnabled()) return [];
    if (this.online() && this.role() === 'player') return this.serverVision() ?? [];
    return visionPolygonsOf(this.visionSources(), this.wallSegments());
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

  /** Itens no chão da camada em foco (mesma referência enquanto não mudam). */
  private readonly drops = computed(
    () => {
      const level = this.currentLevel();
      return (this.activeScene()?.drops ?? NO_DROPS).filter((d) => levelOf(d) === level);
    },
    { equal: sameItems },
  );
  /** Itens no chão exibidos: na visão de jogador com névoa, só os que algum token enxerga. */
  readonly visibleDrops = computed(() => visibleDropsFor(this.drops(), this.role(), this.fogView()));

  // --- Estado da sessão (não persistido) -----------------------------------
  readonly tool = signal<TableTool>('select');
  readonly role = signal<TableRole>('gm');

  /** Troca o papel; no de jogador, sai da ferramenta Névoa (que é só do mestre). Online, o papel é da conta. */
  setRole(role: TableRole): void {
    if (this.online()) return;
    this.applyRole(role);
  }

  private applyRole(role: TableRole): void {
    this.role.set(role);
    if (role === 'player' && this.tool() === 'fog') this.tool.set('select');
  }
  // Seleção de tokens (regras puras em utils/selection.ts). Só se altera pelos métodos abaixo,
  // para o grupo e o principal ficarem sempre coerentes.
  private readonly selection = signal<TokenSelection>(NO_SELECTION);
  /** Token principal (o último clicado; anel azul com alça): janela, ficha, quem age, camadas. */
  readonly selectedTokenId = computed(() => this.selection().primary);
  /** Todos os tokens selecionados (o grupo se move, é removido e copiado junto). */
  readonly selectedTokenIds = computed(() => this.selection().ids);

  /** Seleciona só este token (null = nenhum; também tira a seleção do item no chão). */
  selectToken(id: string | null): void {
    this.selection.set(selectOne(id));
    this.selectedDropId.set(null);
  }

  /** Shift+clique: põe ou tira o token da seleção. */
  toggleTokenSelection(id: string): void {
    this.selection.update((sel) => toggleInSelection(sel, id));
    this.selectedDropId.set(null);
  }

  /** Caixa de seleção: estes tokens (`additive` = somados aos já selecionados). */
  selectTokens(ids: readonly string[], additive: boolean): void {
    this.selection.update((sel) => selectMany(sel, ids, additive));
    if (ids.length) this.selectedDropId.set(null);
  }

  /** Item no chão selecionado (alça de tamanho; Delete o tira do mapa). Exclusivo com os tokens. */
  readonly selectedDropId = signal<string | null>(null);

  /** Seleciona um item no chão (tira a seleção dos tokens). */
  selectDrop(id: string | null): void {
    this.selection.set(NO_SELECTION);
    this.selectedDropId.set(id);
  }

  /** Tokens selecionados da camada em foco que a conta pode mover (o principal primeiro). */
  readonly movableSelection = computed(() => {
    const ids = this.selectedTokenIds();
    const primary = this.selectedTokenId();
    return this.visibleTokens()
      .filter((t) => ids.has(t.placement.id) && this.canEdit(t.entry))
      .sort((a, b) => (a.placement.id === primary ? -1 : b.placement.id === primary ? 1 : 0));
  });
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

  /** Pode editar à mão o máximo das barras de status (só o mestre). */
  readonly canEditStatusMax = computed(() => rules.canEditStatusMax(this.viewer()));

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
  useAction(entry: TableEntry, sheetId?: string): ActionUse | RollRefused | RollSent {
    const config = entry.roll ?? DEFAULT_ROLL;
    const actorSheet = this.actor()?.id === entry.ownerEntryId ? this.actorSheetId() : null;
    const sheet = sheetId ?? actorSheet ?? entry.ownerEntryId;
    // O nível atual das tags da ficha que agiu entra no modificador (tags mágicas: o Poder da ação)
    const levels = this.actionLevels(config, sheet);
    const mana = manaCost(config, levels, this.magicTagIds(sheet));
    const shortfall = this.manaShortfall(sheet, mana);
    if (shortfall) return { refused: shortfall };
    // Mesa online: quem sorteia é o servidor (com as tags atuais da ficha); o resultado vem no chat
    if (this.room) {
      if (!this.sendRoll({ sheetId: sheet ?? undefined, roll: config, label: entry.name, icon: entry.icon ?? 'bolt' })) {
        return { refused: 'Sem conexão com o servidor.' };
      }
      this.armEffect(entry);
      return { sent: true, armed: !!entry.effect };
    }
    const roll: RollResult = {
      action: entry.name,
      icon: entry.icon ?? 'bolt',
      dice: config.dice,
      ...rollDice(config, Math.random, levels),
      ...(mana > 0 && { mana }),
    };
    const author = (sheet && this.sheetData(sheet)?.name) ?? this.actor()?.name ?? this.userName();
    this.spendMana(sheet, mana);
    this.pushChat({ author, roll });
    // Estudos ligados à ação acumulam SA conforme o resultado
    const levelUps = this.trainStudies(sheet, (config.attributes ?? []).map(baseTagId), roll);
    this.armEffect(entry);
    return { author, roll, armed: !!entry.effect, levelUps };
  }

  /** Ação com efeito especial: deixa o efeito "na mão" (ferramenta Efeitos) até o próximo arraste. */
  private armEffect(entry: TableEntry): void {
    if (!entry.effect) return;
    if (this.tool() !== 'fx') this.fxReturnTool = this.tool();
    this.armedFx.set({ ...entry.effect, action: entry.name });
    this.tool.set('fx');
  }

  /**
   * Rolagem básica (botão "Rolar dados" da barra de ações): não é uma ação salva — dado e
   * modificador (já com as tags escolhidas) valem só para esta rolagem. Vai para o chat em
   * nome da ficha `sheetId` (ou do mestre/conta, sem ficha). `studies`: estudos ligados a esta
   * rolagem (sem modificador; acumulam SA conforme o resultado). `itemModifier`: valor das
   * etiquetas de itens escolhidas (exibido à parte no chat); `itemsAdded`: ele já está em `modifier`.
   * `mana`: Poder somado das tags mágicas escolhidas, gasto do Espírito (quem chama confere antes
   * com `manaShortfall`; aqui o gasto nunca deixa a barra abaixo de 0).
   */
  quickRoll(
    dice: DiceKind,
    modifier: number,
    sheetId: string | null,
    itemModifier = 0,
    studies: readonly string[] = [],
    itemsAdded = false,
    mana = 0,
  ): { author: string; roll: RollResult; levelUps: string[] } | null {
    // Mesa online: o servidor sorteia (o modificador já vem somado); null = enviado, o resultado vem no chat
    if (this.room) {
      const roll: RollConfig = { dice, modifier: Math.max(-99, Math.min(99, Math.round(modifier))) };
      if (!this.sendRoll({ sheetId: sheetId ?? undefined, roll, label: 'Rolagem', icon: 'casino' })) {
        this.roomNotice.set({ text: 'Sem conexão com o servidor.' });
      }
      return null;
    }
    const spent = rollUsesTags(dice) ? mana : 0;
    const roll: RollResult = {
      action: 'Rolagem',
      icon: 'casino',
      dice,
      ...rollDice({ dice, modifier }),
      itemModifier,
      itemsAdded,
      ...(spent > 0 && { mana: spent }),
    };
    const author = (sheetId && this.sheetData(sheetId)?.name) || this.userName();
    this.spendMana(sheetId, spent);
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
    const full: ChatMessage = { id: newId(), at: Date.now(), userId: this.me()?.id ?? '', role: this.role(), ...message };
    this.dispatch('addChatMessage', { message: full });
  }

  private userName(): string {
    return this.role() === 'gm' ? 'Mestre' : (this.me()?.name ?? 'Jogador');
  }

  // --- Efeitos especiais (transitórios) ------------------------------------

  /** Efeito escolhido na ferramenta Efeitos. */
  readonly fxStyle = signal<FxStyle>(DEFAULT_FX);
  /** Efeito de uma ação, esperando o usuário arrastar no mapa (vale para um lançamento). */
  readonly armedFx = signal<ArmedFx | null>(null);
  /** Efeitos em exibição no mapa. */
  readonly effects = signal<FxInstance[]>([]);
  /** Último ping de outra pessoa (o mapa mostra). */
  readonly remotePing = signal<Point | null>(null);
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
    // "Fixar no mapa": vai para a cena (salvo) e fica repetindo até ser removido
    const sceneId = this.activeSceneId();
    if (this.fxFixed() && sceneId) {
      const level = this.currentLevel();
      const fx: FixedFx = {
        id,
        kind,
        color,
        from,
        to,
        seed: Math.floor(Math.random() * 2 ** 32),
        scale,
        ...(level > 0 && { level }),
        ownerUserId: this.me()?.id,
      };
      this.dispatch('addFixedFx', { sceneId, fx });
      if (armed) this.cancelArmedFx();
      return;
    }
    // Mesma semente nas outras máquinas: todos veem o mesmo desenho
    const seed = Math.floor(Math.random() * 2 ** 32);
    this.showFx(kind, color, from, to, scale, seed);
    if (this.room && sceneId) {
      const level = this.currentLevel();
      this.room.sendEvent({ kind: 'fx', sceneId, fx: { kind, color, from, to, seed, scale, ...(level > 0 && { level }) } });
    }
    if (armed) this.cancelArmedFx();
  }

  /** Mostra um efeito na tela (transitório: sai sozinho ao terminar). */
  private showFx(kind: FxKind, color: string, from: Point, to: Point, scale: number, seed: number): void {
    const id = newId();
    const drawing = buildFx(kind, color, from, to, { uid: `fx-${id}`, scale, grid: this.activeScene()?.gridSize ?? 70, random: seededRandom(seed) });
    this.effects.update((list) => [...list, { id, drawing }]);
    setTimeout(() => this.effects.update((list) => list.filter((f) => f.id !== id)), drawing.duration + 100);
  }

  // --- Efeitos fixos no mapa (salvos na cena) ------------------------------

  /** Lançar os próximos efeitos fixos no mapa (sessão; opção do menu da ferramenta Efeitos). */
  readonly fxFixed = signal(false);

  /** Efeitos fixos da camada em foco (mesma referência enquanto não mudam). */
  readonly fixedFxList = computed(
    () => {
      const level = this.currentLevel();
      return (this.activeScene()?.effects ?? NO_FIXED_FX).filter((f) => levelOf(f) === level);
    },
    { equal: sameItems },
  );

  /** Desenhos dos efeitos fixos, remontados sempre iguais (mesma semente e zoom do lançamento). */
  readonly fixedEffects = computed<FxInstance[]>(() => {
    const grid = this.activeScene()?.gridSize ?? 70;
    return this.fixedFxList().map((f) => ({
      id: f.id,
      drawing: buildFx(f.kind, f.color, f.from, f.to, { uid: `fx-${f.id}`, scale: f.scale, grid, random: seededRandom(f.seed) }),
    }));
  });

  /** Pode tirar este efeito fixo? (quem lançou e o mestre) */
  canRemoveFixedFx(fx: FixedFx): boolean {
    return rules.canRemoveFixedFx(fx, this.viewer());
  }

  removeFixedFx(fxId: string): void {
    const sceneId = this.activeSceneId();
    const fx = this.fixedFxList().find((f) => f.id === fxId);
    if (sceneId && fx && this.canRemoveFixedFx(fx)) this.dispatch('removeFixedFx', { sceneId, fxId });
  }

  /** Tira os efeitos fixos da camada em foco que a conta pode remover. */
  clearFixedFx(): void {
    const sceneId = this.activeSceneId();
    const fxIds = this.fixedFxList().filter((f) => this.canRemoveFixedFx(f)).map((f) => f.id);
    if (sceneId && fxIds.length) this.dispatch('clearFixedFx', { sceneId, fxIds });
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

    // Jogador na mesa online: busca de novo a Lore quando o que ele pode ver do mundo muda
    effect(() => {
      if (this.loreNeeds()) untracked(() => this.worldbuild.refreshOnline());
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

    // Ações de NPCs-referência criadas antes (gravadas na mesa) passam a morar no NPC do mundo,
    // com o mesmo id. Só move quando o NPC do mundo está carregado (o mundo certo).
    effect(() => {
      // Mesa online: quem grava no mundo é o mestre (e o mundo dele precisa ter carregado)
      if (!this.loaded() || (this.online() && (this.role() !== 'gm' || !this.worldbuild.loaded()))) return;
      const legacy = this.state().entries.filter((e) => e.kind === 'automation' && !!this.abilityTarget(e.ownerEntryId));
      if (!legacy.length) return;
      untracked(() => {
        for (const action of legacy) {
          this.dispatch('removeEntry', { entryId: action.id });
          this.placeEntry(action);
        }
      });
    });
  }

  // --- Carregamento --------------------------------------------------------

  /**
   * Jogador na mesa online: o que ele precisa do mundo muda com a mesa (pastas reveladas, NPCs à
   * vista, itens nos inventários e no chão). Texto: mudanças que não tocam nisso não buscam nada.
   */
  private readonly loreNeeds = computed(() => {
    if (!this.online() || this.role() === 'gm') return '';
    const state = this.state();
    const npcs = state.entries.flatMap((e) => e.worldNpcId ?? []);
    return JSON.stringify([...(state.lore?.revealed ?? []), ...npcs, ...worldItemRefs(state)].sort());
  });

  async load(tableId: string): Promise<void> {
    // Nessa ordem: com a sala aberta, o flush não grava nada (o estado online nunca vai para o IndexedDB)
    this.flush();
    this.disconnect();
    this.tableId = tableId;
    this.loaded.set(false);
    this.state.set(normalizeState(await this.storage.get<TableState>(this.key())));
    this.loaded.set(true);
  }

  /**
   * Abre uma mesa online: conecta na sala do servidor e espera o estado inicial (`welcome`).
   * Até lá, nenhum comando é aplicado (nem gravado no navegador).
   */
  connect(tableId: string): void {
    this.flush();
    this.disconnect();
    this.tableId = tableId;
    this.loaded.set(false);
    // Arquivos da mesa online (mapas, tokens, sons, itens) vão para o servidor
    this.files = new ServerFileStore(this.api, { tableId });
    this.room = new TableRoom(
      tableId,
      (message) => this.onRoomMessage(message),
      (status, reason) => {
        this.roomStatus.set(status);
        this.roomProblem.set(reason ?? '');
      },
    );
  }

  /** Sai da sala (ao sair da mesa ou abrir outra). Sem mesa carregada, nada é gravado no navegador. */
  disconnect(): void {
    if (!this.room) return;
    this.loaded.set(false);
    clearTimeout(this.burstTimer);
    this.burstTimer = undefined;
    this.bursts.clear();
    this.room?.close();
    this.room = null;
    this.sync = null;
    this.files = this.localFiles;
    this.online.set(null);
    this.serverVision.set(null);
    this.roomStatus.set('offline');
  }

  /** Mensagem da sala: estado inicial, confirmações, comandos dos outros e estados projetados. */
  private onRoomMessage(message: RoomMessage): void {
    switch (message.t) {
      case 'welcome':
        this.online.set(message.you);
        this.applyRole(message.you.role);
        this.serverVision.set(message.vision);
        // Reconexão também chega aqui: o que estava pendente é descartado (o servidor manda tudo de novo)
        clearTimeout(this.burstTimer);
        this.burstTimer = undefined;
        this.bursts.clear();
        this.applySync(startSync(normalizeState(message.state), message.version));
        this.loaded.set(true);
        return;
      case 'state':
        this.serverVision.set(message.vision);
        if (this.sync) this.applySync(replaceState(this.sync, normalizeState(message.state), message.version));
        return;
      case 'cmd':
        if (this.sync) this.applySync(remoteCommand(this.sync, { type: message.type, payload: message.payload } as TableCommand, message.version));
        return;
      case 'ack':
        if (message.type === 'roll') this.serverRoll.set(message.payload as ChatMessage);
        else if (this.sync) this.applySync(ackCommand(this.sync, message.seq, { type: message.type, payload: message.payload } as TableCommand, message.version));
        return;
      case 'nack':
        if (this.sync) this.applySync(rejectCommand(this.sync, message.seq));
        this.roomNotice.set({ text: `O servidor recusou: ${message.reason}` });
        return;
      case 'error':
        this.roomNotice.set({ text: message.message });
        return;
      case 'world':
        this.worldbuild.refreshOnline();
        return;
      case 'event':
        this.onRoomEvent(message.event);
        return;
    }
  }

  /** Ping ou efeito de outra pessoa: aparece aqui se for a cena aberta (efeito: na camada em foco). */
  private onRoomEvent(event: RoomEvent): void {
    if (event.sceneId !== this.activeSceneId()) return;
    if (event.kind === 'ping') {
      this.remotePing.set({ x: event.x, y: event.y });
      return;
    }
    const { fx } = event;
    if (levelOf(fx) === this.currentLevel()) this.showFx(fx.kind, fx.color, fx.from, fx.to, fx.scale, fx.seed);
  }

  /** Marca um ping para os outros na mesa online (na mesa local, só o próprio mapa mostra). */
  sendPing(p: Point): void {
    const sceneId = this.activeSceneId();
    if (this.room && sceneId) this.room.sendEvent({ kind: 'ping', sceneId, x: p.x, y: p.y });
  }

  /** Envia as rajadas pendentes, cada uma como um comando só (troca os pendentes dela por ele). */
  private sendBursts(): void {
    clearTimeout(this.burstTimer);
    this.burstTimer = undefined;
    if (!this.room || !this.sync) return this.bursts.clear();
    for (const { seqs, commands } of this.bursts.values()) {
      const command = mergeBurst(commands);
      const seq = this.room.nextSeq();
      this.applySync(squashPending(this.sync, seqs, seq, command));
      this.sendToRoom(seq, command);
    }
    this.bursts.clear();
  }

  /** Envia um comando já aplicado na tela; sem conexão, desfaz (ao reconectar, o servidor manda tudo de novo). */
  private sendToRoom(seq: number, command: TableCommand): void {
    if (this.room?.sendCommand(seq, command.type, command.payload) || !this.sync) return;
    this.applySync(rejectCommand(this.sync, seq));
    this.roomNotice.set({ text: 'Sem conexão com o servidor: a alteração não foi feita.' });
  }

  private applySync(sync: SyncState): void {
    this.sync = sync;
    this.state.set(sync.view);
  }

  private sendRoll(roll: RoomRoll): boolean {
    return !!this.room?.sendRoll(this.room.nextSeq(), roll);
  }

  // --- Cenas ---------------------------------------------------------------

  /** Cria uma cena (com mapa opcional) e a torna ativa. */
  async addScene(file?: File): Promise<Scene> {
    // Envio recusado: a cena é criada sem mapa (o aviso explica o motivo)
    const blobId = (file && (await this.uploadFile(file))) || undefined;
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
    this.selectToken(null);
    return scene;
  }

  /** Troca (ou define) o mapa de uma cena. */
  async setSceneMap(sceneId: string, file: File): Promise<void> {
    const old = this.scenes().find((s) => s.id === sceneId)?.blobId;
    const blobId = await this.uploadFile(file);
    if (!blobId) return;
    this.updateScene(sceneId, { blobId });
    if (old) void this.files.remove(old);
  }

  updateScene(id: string, patch: Partial<Omit<Scene, 'id'>>): void {
    this.dispatch('updateScene', { sceneId: id, patch });
  }

  setActiveScene(id: string): void {
    this.dispatch('setActiveScene', { sceneId: id });
    this.selectToken(null);
  }

  /** Exclui a cena e apaga os arquivos dos mapas dela (térreo e camadas). */
  removeScene(id: string): void {
    const scene = this.scenes().find((s) => s.id === id);
    this.dispatch('removeScene', { sceneId: id });
    for (const blobId of [scene?.blobId, ...(scene?.levels ?? []).map((l) => l.blobId)]) {
      if (blobId) void this.files.remove(blobId);
    }
    // Imagens personalizadas dos inventários dos tokens de NPC da cena e dos itens no chão
    for (const token of scene?.tokens ?? []) this.deleteInventoryBlobs(token.sheet?.inventory);
    this.deleteInventoryBlobs(scene?.drops?.map((d) => d.item));
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

  /** Mestre: passa a olhar outra camada (saem da seleção os tokens que não estão nela). */
  viewLevel(level: number): void {
    const target = this.clampLevel(level);
    this.gmLevel.set(target);
    this.selection.update((sel) =>
      keepOnly(sel, (id) => {
        const token = this.findPlacement(id);
        return !token || levelOf(token) === target;
      }),
    );
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
    const blobId = await this.uploadFile(file);
    if (!blobId) return;
    this.dispatch('setLevelImage', { sceneId: scene.id, index, blobId });
    if (old) void this.files.remove(old);
  }

  /** Tira a imagem de uma camada de cima: ela vira "ar" (mostra a de baixo). */
  clearLevelImage(index: number): void {
    const scene = this.activeScene();
    const old = scene?.levels?.[index - 1]?.blobId;
    if (!scene || index < 1 || !old) return;
    this.dispatch('setLevelImage', { sceneId: scene.id, index });
    void this.files.remove(old);
  }

  /** Exclui uma camada de cima; os tokens dela descem uma camada e as paredes dela são apagadas. */
  removeLevel(index: number): void {
    const scene = this.activeScene();
    const level = scene?.levels?.[index - 1];
    if (!scene || index < 1 || !level) return;
    this.dispatch('removeLevel', { sceneId: scene.id, index });
    this.gmLevel.update((n) => (n >= index ? n - 1 : n));
    if (level.blobId) void this.files.remove(level.blobId);
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
      ...(kind === 'character' && { ownerUserId: this.me()?.id }),
      ...extra,
    };
    this.placeEntry(entry);
    return entry;
  }

  /** Grava uma entrada nova: habilidade de NPC-referência vai para o NPC do mundo; o resto, para a mesa. */
  private placeEntry(entry: TableEntry): void {
    const npc = entry.kind === 'automation' ? this.abilityTarget(entry.ownerEntryId) : undefined;
    if (npc) this.worldbuild.update(npc.id, { abilities: withAbility(npc.abilities, toStoredAbility(entry)) });
    else this.dispatch('addEntry', { entry });
  }

  /** NPC do mundo que guarda as ações deste dono (só NPC-referência). */
  private abilityTarget(ownerEntryId: string | undefined): WorldItem | undefined {
    const owner = ownerEntryId ? this.state().entries.find((e) => e.id === ownerEntryId) : undefined;
    return owner ? this.worldNpcOf(owner) : undefined;
  }

  /** Envia um arquivo de áudio e cria o som correspondente (null = envio recusado; o aviso explica). */
  async uploadSound(file: File): Promise<TableEntry | null> {
    const blobId = await this.uploadFile(file);
    if (!blobId) return null;
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

  /** Mesa online (mestre): toca ou para um som para todos. */
  setSoundPlaying(entryId: string, playing: boolean): void {
    this.dispatch('setSoundPlaying', { entryId, playing, startedAt: Date.now() });
  }

  /** Mesa online (mestre): para todos os sons. */
  stopAllSounds(): void {
    this.dispatch('stopAllSounds', {});
  }

  /**
   * Altera um arquivo. Habilidade de NPC-referência é gravada no NPC do mundo; trocar o dono
   * de uma ação a muda de lugar (mesa ↔ NPC do mundo), mantendo o id.
   */
  updateEntry(id: string, patch: Partial<Omit<TableEntry, 'id' | 'kind'>>): void {
    const current = this.entryById().get(id);
    const ownerChanged = !!current && 'ownerEntryId' in patch && patch.ownerEntryId !== current.ownerEntryId;
    const homeId = this.abilityHome().get(id);
    const movesToWorld = ownerChanged && current.kind === 'automation' && !!this.abilityTarget(patch.ownerEntryId);
    if (current && (ownerChanged ? homeId || movesToWorld : homeId)) {
      const updated = { ...current, ...patch };
      if (ownerChanged) {
        this.removeEntry(id);
        this.placeEntry(updated);
      } else if (homeId) {
        const npc = this.worldbuild.byId().get(homeId);
        if (npc) this.worldbuild.update(homeId, { abilities: withAbility(npc.abilities, toStoredAbility(updated)) });
      }
      return;
    }
    this.dispatch('updateEntry', { entryId: id, patch });
  }

  /** Exclui o arquivo, as ações dele, os tokens dele em todas as cenas e os arquivos (áudio/imagem). */
  removeEntry(id: string): void {
    // Habilidade de NPC-referência: sai do NPC do mundo (de todas as mesas do mundo)
    const homeId = this.abilityHome().get(id);
    if (homeId) {
      const npc = this.worldbuild.byId().get(homeId);
      if (npc) this.worldbuild.update(homeId, { abilities: withoutAbility(npc.abilities, id) });
      return;
    }
    const entry = this.entryById().get(id);
    // Os tokens dele saem de todas as cenas (com as cópias de inventário)
    for (const sc of this.scenes()) {
      for (const token of sc.tokens ?? []) if (token.entryId === id) this.deleteInventoryBlobs(token.sheet?.inventory);
    }
    this.dispatch('removeEntry', { entryId: id });
    if (entry?.blobId) void this.files.remove(entry.blobId);
    if (entry?.token?.blobId) void this.files.remove(entry.token.blobId);
    // Imagens personalizadas dos itens do inventário
    this.deleteInventoryBlobs(entry?.sheet?.inventory);
  }

  /**
   * Lê um arquivo. Na mesa online, vem do servidor (arquivos da mesa e do mundo dela); o navegador
   * vem antes para as imagens de mesas criadas quando o Worldbuild ainda era só local.
   */
  async getBlob(blobId: string): Promise<Blob | undefined> {
    const local = await this.localFiles.get(blobId);
    return local ?? (this.files === this.localFiles ? undefined : this.files.get(blobId));
  }

  /** Envio recusado (mesa online: cota do servidor, tipo não aceito, sem conexão): aviso na tela. */
  protected override uploadFailed(error: unknown): void {
    this.roomNotice.set({ text: `Arquivo não enviado: ${error instanceof Error ? error.message : 'erro desconhecido.'}` });
  }

  // --- NPCs do bestiário (referências) -------------------------------------

  /**
   * NPCs do bestiário do mundo da mesa, por id. Igualdade por referência dos itens: editar
   * documentos ou outros itens do Worldbuild não recalcula tokens e fichas da mesa — só
   * mudanças nos próprios NPCs.
   */
  private readonly worldNpcMap = computed(() => new Map(this.worldbuild.worldNpcs().map((i) => [i.id, i] as const)), {
    equal: (a, b) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v),
  });

  /** Ficha base no bestiário de um NPC-referência (undefined se não for referência ou se o original sumiu). */
  worldNpcOf(entry: TableEntry): WorldItem | undefined {
    return entry.worldNpcId ? this.worldNpcMap().get(entry.worldNpcId) : undefined;
  }

  /** Onde mora a ficha base dos NPCs-referência: o Worldbuild do mundo da mesa. */
  private worldServiceOf(_entry: TableEntry): WorldbuildService {
    return this.worldbuild;
  }

  /** NPCs do bestiário do mundo que podem entrar na mesa. */
  readonly bestiary = computed(() => [...this.worldNpcMap().values()]);

  /** Põe na mesa um NPC do bestiário (a entrada é só uma referência à ficha base). */
  addNpcReference(item: WorldItem): TableEntry {
    return this.addEntry('npc', { name: item.name, worldNpcId: item.id });
  }

  /** Cria um NPC novo no Worldbuild do mundo e já o põe na mesa. */
  createWorldNpc(): TableEntry {
    return this.addNpcReference(this.worldbuild.create('npc'));
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
        ...theme.tags.map((t) => ({
          id: t.id,
          text: t.text.trim() || 'Tag sem nome',
          level: t.level,
          theme: themeName,
          flaw: false,
          ...(t.magic && { magic: true }),
        })),
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
    const sources = { own: this.worldbuild.byId(), table: this.tableItemById() };
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
    const roll = action.roll ?? DEFAULT_ROLL;
    return formatRoll(roll, this.actionLevels(roll, sheetId));
  }

  // --- Tags mágicas: Poder e Mana (barra Espírito) -------------------------

  /** Ids das tags mágicas da ficha. */
  magicTagIds(sheetId: string | null | undefined): ReadonlySet<string> {
    return new Set(this.themeTagsOf(sheetId ?? undefined).filter((t) => t.magic).map((t) => t.id));
  }

  /** Níveis das tags da ficha para uma ação: as mágicas valem o Poder salvo nela (até o nível atual). */
  private actionLevels(roll: RollConfig, sheetId: string | null | undefined): TagLevels {
    return withPowers(roll, this.tagLevelsOf(sheetId ?? undefined), this.magicTagIds(sheetId));
  }

  /** Mana (Espírito) gasta ao usar a ação, com o Poder salvo nela. */
  manaCostOf(action: TableEntry, sheetId = action.ownerEntryId): number {
    const roll = action.roll ?? DEFAULT_ROLL;
    return manaCost(roll, this.actionLevels(roll, sheetId), this.magicTagIds(sheetId));
  }

  /** Mana disponível (valor atual do Espírito) da ficha; null = sem ficha. */
  manaOf(sheetId: string | null | undefined): number | null {
    const data = sheetId ? this.sheetData(sheetId) : null;
    return data ? (data.bars.find((b) => b.id === MANA_BAR)?.value ?? 0) : null;
  }

  /** Motivo para não rolar: a ficha não tem Espírito suficiente para o Poder das tags mágicas (null = pode). */
  manaShortfall(sheetId: string | null | undefined, cost: number): string | null {
    if (cost <= 0) return null;
    const mana = this.manaOf(sheetId);
    if (mana === null || mana >= cost) return null;
    const name = this.sheetData(sheetId!)?.name ?? 'O personagem';
    return `${name} não tem Espírito suficiente: precisa de ${cost}, tem ${mana}.`;
  }

  /** Gasta Mana do Espírito da ficha (nunca abaixo de 0). */
  private spendMana(sheetId: string | null | undefined, cost: number): void {
    const data = cost > 0 && sheetId ? this.sheetData(sheetId) : null;
    if (!data || !sheetId) return;
    const bars = data.bars.map((b) => (b.id === MANA_BAR ? { ...b, value: Math.max(0, b.value - cost) } : b));
    this.updateStatus(sheetId, { bars });
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
    const to = this.sheetData(toId);
    if (!to || fromId === toId || !inventoryHolder(this.state(), toId)) return false;
    if (cost > 0 && to.sheet.eiros < cost) return false;
    const blobId = await this.imageForUnit(fromId, inventoryId);
    if (blobId === null) return false;
    this.dispatch('transferItem', { fromId, inventoryId, toId, newEntryId: newId(), ...(cost > 0 && { cost }), ...(blobId && { blobId }) });
    // Item que saiu da ficha deixa de valer nas ações dela
    if (!tokenSheetPlacement(fromId) && this.sheetAccess(fromId).edit) this.pruneItemTags(fromId);
    return true;
  }

  /**
   * Imagem da unidade que vai sair do inventário: enquanto a linha ficar na origem, uma cópia
   * (cada lugar cuida da sua). undefined = sem imagem a copiar; null = não há o que tirar.
   */
  private async imageForUnit(sheetId: string, inventoryId: string): Promise<string | undefined | null> {
    const holder = inventoryHolder(this.state(), sheetId);
    const item = holder?.sheet.inventory.find((i) => i.id === inventoryId);
    if (!holder || !item || quantityOf(item) < 1) return null;
    if (!unitNeedsImageCopy(holder, item)) return undefined;
    return this.files.copy(item.blobId!).catch(() => undefined);
  }

  // --- Itens no mapa (largar e pegar) --------------------------------------

  /** Mestre: larga itens do mundo/da mesa, move, muda a quantidade e tira itens do mapa. */
  readonly canManageDrops = computed(() => rules.canManageDrops(this.viewer()));

  /** Item no chão (em qualquer cena), com a cena dele. */
  dropById(dropId: string): { scene: Scene; drop: DroppedItem } | undefined {
    return findDrop(this.scenes(), dropId);
  }

  /** A conta vê este item? (jogador com névoa: só os que algum token enxerga agora) */
  canSeeDrop(dropId: string): boolean {
    return this.role() === 'gm' || this.visibleDrops().some((d) => d.id === dropId);
  }

  /**
   * Larga um item no mapa, na cena ativa e na camada em foco (centro em `p`):
   * - do mundo (aba Lore) ou da mesa: só o mestre — um item novo, sem personalização;
   * - do inventário: quem edita a ficha — uma unidade sai dela (com nome, etiquetas e imagem próprios).
   */
  async dropItem(data: ItemDragData, p: Point): Promise<DroppedItem | null> {
    const sceneId = this.activeSceneId();
    if (!sceneId) return null;
    const level = this.currentLevel();
    const dropId = newId();
    if (data.source === 'inventory') {
      if (!this.sheetAccess(data.sheetId).edit) return null;
      const blobId = await this.imageForUnit(data.sheetId, data.inventoryId);
      if (blobId === null) return null;
      // A cena pode ter mudado durante o await: o item vai para a cena de onde foi largado
      this.dispatch('dropFromInventory', {
        sceneId,
        sheetId: data.sheetId,
        inventoryId: data.inventoryId,
        dropId,
        itemEntryId: newId(),
        x: p.x,
        y: p.y,
        ...(level > 0 && { level }),
        ...(blobId && { blobId }),
      });
      if (!tokenSheetPlacement(data.sheetId)) this.pruneItemTags(data.sheetId);
      return this.dropById(dropId)?.drop ?? null;
    }
    const exists = data.source === 'table' ? this.tableItemById().has(data.itemId) : this.worldbuild.byId().get(data.itemId)?.type === 'item';
    if (!this.canManageDrops() || !exists) return null;
    const drop: DroppedItem = {
      id: dropId,
      x: p.x,
      y: p.y,
      ...(level > 0 && { level }),
      item: { id: newId(), itemId: data.itemId, ...(data.source === 'table' && { table: true }) },
    };
    this.dispatch('addDrop', { sceneId, drop });
    return drop;
  }

  /**
   * Pega o item do chão com a ficha `sheetId` (personagem ou token de NPC): a pilha inteira vai
   * para o inventário (empilha num item idêntico) e o item sai do mapa. A imagem personalizada
   * vai junto. Precisa editar a ficha e ver o item. Retorna o nome do item (null = não pegou).
   */
  pickUpDrop(dropId: string, sheetId: string): string | null {
    const drop = this.dropById(dropId)?.drop;
    if (!drop || !this.canSeeDrop(dropId) || !this.sheetAccess(sheetId).edit || !this.sheetData(sheetId)) return null;
    const name = inventoryRow(drop.item, { own: this.worldbuild.byId(), table: this.tableItemById() }).name;
    if (!inventoryHolder(this.state(), sheetId)) return null;
    this.dispatch('pickUpDrop', { dropId, sheetId, newEntryId: newId() });
    return name;
  }

  /** Mestre: move o item no mapa. */
  moveDrop(dropId: string, p: Point): void {
    if (this.canManageDrops()) this.dispatch('moveDrop', { dropId, x: p.x, y: p.y });
  }

  /** Mestre: quantidade da pilha no chão. */
  setDropQuantity(dropId: string, quantity: number): void {
    if (this.canManageDrops()) this.dispatch('setDropQuantity', { dropId, quantity });
  }

  /** Mestre: tamanho (quadrados) e cor da borda do item no mapa. */
  updateDrop(dropId: string, patch: Partial<Pick<DroppedItem, 'size' | 'color'>>): void {
    if (this.canManageDrops()) this.dispatch('updateDrop', { dropId, patch });
  }

  /** Mestre: tira o item do mapa (sem ir para inventário nenhum; a imagem personalizada é apagada). */
  removeDrop(dropId: string): void {
    const drop = this.dropById(dropId)?.drop;
    if (!drop || !this.canManageDrops()) return;
    if (this.selectedDropId() === dropId) this.selectedDropId.set(null);
    this.dispatch('removeDrop', { dropId });
    this.deleteInventoryBlobs([drop.item]);
  }

  /**
   * Quem pode pegar um item: personagens (mestre: todos; jogador: os dele) e tokens de NPC que a
   * conta controla, na cena ativa. Ordem: quem age primeiro, depois os mais próximos do item.
   */
  pickupCandidates(drop: DroppedItem): PickupCandidate[] {
    const grid = this.activeScene()?.gridSize ?? 70;
    const level = levelOf(drop);
    const near = (t: ResolvedToken) =>
      levelOf(t.placement) === level ? Math.hypot(t.placement.x - drop.x, t.placement.y - drop.y) / grid : undefined;
    const tokens = this.resolvedTokens();
    const characters = (this.role() === 'gm' ? this.entries().filter((e) => e.kind === 'character') : this.myCharacters()).map((e) => {
      const distances = tokens.filter((t) => t.entry.id === e.id).flatMap((t) => near(t) ?? []);
      return { sheetId: e.id, name: e.name, blobId: this.tokenOf(e).blobId, distance: distances.length ? Math.min(...distances) : undefined };
    });
    const npcTokens = tokens
      .filter((t) => t.entry.kind === 'npc' && this.canEdit(t.entry))
      .map((t) => ({ sheetId: NPC_TOKEN_SHEET + t.placement.id, name: t.name, blobId: t.blobId, distance: near(t) }));
    const actor = this.actorSheetId();
    const far = Number.POSITIVE_INFINITY;
    return [...characters, ...npcTokens].sort(
      (a, b) => Number(b.sheetId === actor) - Number(a.sheetId === actor) || (a.distance ?? far) - (b.distance ?? far),
    );
  }

  // --- Lore da mesa (pastas do mundo reveladas) ----------------------------
  // A aba Lore espelha a árvore do mundo: criar, renomear, mover e excluir vão
  // direto para o WorldbuildService. A mesa guarda só o que foi revelado.

  /** Pastas do mundo reveladas aos jogadores nesta mesa. */
  readonly revealedLore = computed(() => new Set(this.lore().revealed));

  /** Mestre: revela ou esconde dos jogadores uma pasta do mundo (e tudo dentro dela). */
  toggleLoreReveal(folderId: string): void {
    this.dispatch('toggleLoreReveal', { folderId });
  }

  /** O jogador pode ver este item da lore? (regra em `rules.canSeeLoreItem`; o mestre vê tudo) */
  canSeeLoreItem(itemId: string): boolean {
    const byId = this.worldbuild.byId();
    return rules.canSeeLoreItem(
      this.revealedLore(),
      (id) => byId.get(id)?.parentId,
      itemId,
      this.tableItemById().has(itemId),
      this.viewer(),
    );
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
      ownerUserId: this.me()?.id,
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
    const blobId = await this.uploadFile(file);
    if (!blobId) return;
    this.dispatch('updateTableItem', { itemId, patch: { blobId } });
    if (old) void this.files.remove(old);
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
    // NPC do bestiário: a imagem é do mundo (continua lá se esta mesa for excluída). Só o mestre grava no mundo.
    const worldImage = !!this.worldNpcOf(entry) && this.role() === 'gm';
    const blobId = worldImage ? await this.worldbuild.storeBlob(file).catch(() => null) : await this.uploadFile(file);
    if (!blobId) return;
    const old = this.tokenOf(entry).blobId;
    this.updateEntryToken(entryId, { blobId });
    if (!old) return;
    if (worldImage) this.worldbuild.deleteBlob(old);
    else void this.files.remove(old);
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
    this.selectToken(placement.id);
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
    if (this.canMoveTokenTo(placementId, p)) this.dispatch('moveToken', { placementId, x: p.x, y: p.y });
  }

  /**
   * Move vários tokens de uma vez (grupo selecionado), num comando só. No papel de jogador,
   * os que atravessariam uma parede ou porta fechada ficam onde estão.
   */
  moveTokens(moves: { placementId: string; x: number; y: number }[]): void {
    const allowed = moves.filter((m) => this.canMoveTokenTo(m.placementId, m));
    if (allowed.length) this.dispatch('moveTokens', { moves: allowed });
  }

  /**
   * O token pode ir da posição atual até `to`? Jogador: não atravessa paredes nem portas
   * fechadas da camada dele (regra em `rules.wallsBlockMovement` + `movePathBlocked`).
   */
  canMoveTokenTo(placementId: string, to: Point): boolean {
    const placement = this.findPlacement(placementId);
    if (!placement || !rules.wallsBlockMovement(this.viewer())) return true;
    return !movePathBlocked(placement, to, this.segmentsAt(levelOf(placement)));
  }

  /** Segmentos de parede de uma camada da cena ativa (a em foco já vem calculada). */
  private segmentsAt(level: number): Segment[] {
    if (level === this.currentLevel()) return this.wallSegments();
    return wallsToSegments((this.activeScene()?.walls ?? NO_WALLS).filter((w) => levelOf(w) === level));
  }

  /** Remove o token do mapa (a ficha continua; a cópia do NPC, com o inventário dela, some). */
  removeToken(placementId: string): void {
    this.deleteInventoryBlobs(this.findPlacement(placementId)?.sheet?.inventory);
    this.dispatch('removeToken', { placementId });
    this.selection.update((sel) => without(sel, [placementId]));
  }

  // --- Copiar e colar tokens (Ctrl+C / Ctrl+V) -----------------------------

  /**
   * Tokens copiados (sessão, não salvo), como estavam no Ctrl+C, o principal primeiro.
   * Valem para colar em qualquer cena desta mesa.
   */
  private readonly clipboard = signal<TokenPlacement[]>([]);
  /** Tokens copiados com as configurações efetivas (sem os de fichas já excluídas). */
  readonly copiedTokens = computed(() => this.clipboard().flatMap((p) => this.resolveToken(p) ?? []));

  /** Copia os tokens (só os que a conta pode editar; o primeiro é a referência ao colar). Retorna quantos copiou. */
  copyTokens(placementIds: readonly string[]): number {
    const tokens = placementIds.flatMap((id) => this.resolvedTokenById(id) ?? []).filter((t) => this.canEdit(t.entry));
    if (tokens.length) this.clipboard.set(tokens.map((t) => structuredClone(t.placement)));
    return tokens.length;
  }

  /**
   * Cola cópias exatas dos tokens copiados na cena ativa, na camada em foco: o primeiro com centro
   * em `p` e os demais na mesma formação. Seleciona o grupo colado. As imagens do inventário (NPC)
   * ganham cópias próprias. Pode colar várias vezes.
   */
  pasteTokens(p: Point): TokenPlacement[] {
    const copied = this.copiedTokens().filter((t) => this.canEdit(t.entry));
    const sceneId = this.activeSceneId();
    if (!copied.length || !sceneId) return [];
    const anchor = copied[0].placement;
    const pasted = copied.map((t) =>
      copyPlacement(t.placement, {
        id: newId(),
        x: p.x + t.placement.x - anchor.x,
        y: p.y + t.placement.y - anchor.y,
        level: this.currentLevel(),
      }),
    );
    for (const placement of pasted) {
      this.dispatch('placeToken', { sceneId, placement });
      if (placement.sheet?.inventory.some((i) => i.blobId)) void this.cloneTokenInventoryBlobs(placement.id);
    }
    this.selection.set(selectMany(NO_SELECTION, pasted.map((t) => t.id), false));
    return pasted;
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
    // Mesa online: a memória é gravada pelo mestre (o jogador não pode alterá-la no servidor)
    if (this.online() && this.role() !== 'gm') return;
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
   * e agenda a gravação (alterações seguidas viram uma só). Na mesa online, o comando aparece
   * na tela na hora e vai para o servidor, que o confirma (`ack`) ou recusa (`nack`).
   */
  private dispatch<K extends TableCommandType>(type: K, payload: TableCommandPayload<K>): void {
    if (this.room) {
      // Antes do estado inicial chegar não há o que alterar
      if (!this.sync) return;
      const command = { type, payload } as TableCommand;
      const seq = this.room.nextSeq();
      const next = localCommand(this.sync, seq, command);
      if (next === this.sync) return;
      this.applySync(next);
      // Rajada (um comando por quadro): vai agrupada; os demais vão na hora, depois das rajadas, na ordem
      const key = burstKey(command);
      if (key) {
        const burst = this.bursts.get(key) ?? { seqs: [], commands: [] };
        burst.seqs.push(seq);
        burst.commands.push(command);
        this.bursts.set(key, burst);
        this.burstTimer ??= setTimeout(() => this.sendBursts(), BURST_MS);
        return;
      }
      this.sendBursts();
      this.sendToRoom(seq, command);
      return;
    }
    const next = applyCommand(this.state(), { type, payload } as Parameters<typeof applyCommand>[1]);
    if (next === this.state()) return;
    this.state.set(next);
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 300);
  }

  /** Grava imediatamente o que estiver pendente (mesa online: quem grava é o servidor). */
  flush(): void {
    clearTimeout(this.saveTimer);
    if (this.room) return;
    if (this.loaded() && this.tableId) this.storage.set(this.key(), this.state());
  }
}
