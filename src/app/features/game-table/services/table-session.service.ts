import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Point } from '../../../core/models/geometry.model';
import { WorldItem } from '../../../core/models/world-item.model';
import {
  BRUSH_COLORS,
  BRUSH_WIDTHS,
  ChatMessage,
  DEFAULT_FX,
  DEFAULT_ROLL,
  DEFAULT_SOUND_VOLUME,
  DEFAULT_TOKEN_SPEED,
  DoorWall,
  FxStyle,
  MAX_CHAT_MESSAGES,
  MAX_MAP_LEVELS,
  MapLevel,
  SceneFolder,
  RollResult,
  LoreFolder,
  LoreItemOverride,
  METERS_PER_SQUARE,
  MapNote,
  NOTE_COLORS,
  Scene,
  Stroke,
  TABLE_ENTRY_META,
  TableEntry,
  TableEntryKind,
  TableRole,
  TableLore,
  TableState,
  TableTool,
  TokenBar,
  TokenPlacement,
  TokenSettings,
  TokenTag,
  TokenVision,
  Wall,
  CharacterSheet,
  SHEET_THEME_COUNT,
  defaultSheet,
  defaultToken,
  withStatusBars,
} from '../../../core/models/table-session.model';
import { AuthService } from '../../../core/services/auth.service';
import { StorageService } from '../../../core/services/storage.service';
import { newId } from '../../../core/utils/id';
import { rollDice } from '../utils/dice';
import { FxDrawing, buildFx, seededRandom } from '../utils/effects';
import { createMask, decodeMask, encodeMask, isExploredAt, markPolygons, maskFits } from '../utils/fog-memory';
import { computeVisibilityPolygon, doorSeen, pointInPolygon, wallsToSegments } from '../utils/visibility';

/** Barras da mesa que podem ser escondidas. */
export interface TablePanels {
  scenes: boolean;
  tools: boolean;
  side: boolean;
  actions: boolean;
}

/**
 * Token com as configurações efetivas (regra de vínculo já aplicada).
 * É o que o mapa e a janela "Token" exibem.
 */
export interface ResolvedToken {
  placement: TokenPlacement;
  entry: TableEntry;
  /** Personagem: alterações valem para a ficha e todos os tokens dela. */
  linked: boolean;
  blobId?: string;
  size: number;
  vision: TokenVision;
  /** Quadrados por segundo com WASD/setas (sempre da ficha). */
  speed: number;
  bars: TokenBar[];
  tags: TokenTag[];
}

/** Campos do token editáveis pela ficha ou pela janela "Token". */
export type TokenPatch = Partial<Pick<TokenSettings, 'size' | 'vision' | 'speed' | 'bars' | 'tags'>>;

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
type DrawAction = { kind: 'add'; strokeId: string } | { kind: 'erase'; removed: { stroke: Stroke; index: number }[] };

/** Omit que preserva cada membro de uma união (ex.: Wall sem o id). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

const EMPTY_STATE: TableState = { scenes: [], activeSceneId: null, entries: [] };
const EMPTY_LORE: TableLore = { folders: [], items: {} };
const NO_TOKENS: TokenPlacement[] = [];
const NO_WALLS: Wall[] = [];
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

/** Camada de um token (tokens antigos ficam no térreo). */
export function levelOf(placement: TokenPlacement): number {
  return placement.level ?? 0;
}

/**
 * Estado da mesa aberta: cenas, arquivos (fichas, sons, automações),
 * tokens, ferramenta ativa e papel do usuário (mestre ou jogador).
 *
 * Fornecido no componente da mesa — cada mesa aberta tem sua instância.
 * Salva no IndexedDB com a chave "table-state:<id>". Toda mutação passa
 * por patchState (gravação agrupada com debounce de 300ms).
 */
@Injectable()
export class TableSessionService {
  private readonly storage = inject(StorageService);
  private readonly auth = inject(AuthService);

  // --- Estado persistido ---------------------------------------------------
  private readonly state = signal<TableState>(EMPTY_STATE);
  private tableId = '';
  private saveTimer?: ReturnType<typeof setTimeout>;

  readonly loaded = signal(false);
  readonly scenes = computed(() => this.state().scenes);
  readonly entries = computed(() => this.state().entries);
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
  readonly levelCount = computed(() => Math.max(1, this.mapLevels().length));
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

  /** Desenhos da cena ativa. */
  readonly drawings = computed(() => this.activeScene()?.drawings ?? NO_STROKES);
  /** Anotações da cena ativa. */
  readonly notes = computed(() => this.activeScene()?.notes ?? NO_NOTES);

  /**
   * Anotações exibidas: na visão de jogador somem as "só mestre" e, com névoa,
   * as que estão fora da área visível.
   */
  readonly visibleNotes = computed(() => {
    const notes = this.notes();
    if (this.role() !== 'player') return notes;
    const polys = this.visionPolygons();
    const explored = this.explored();
    // Anotações em áreas já exploradas continuam visíveis (o jogador lembra o que viu)
    return notes.filter((n) => !n.gmOnly && (this.isVisible(n, polys) || (explored && isExploredAt(explored, n))));
  });

  // --- Névoa de guerra e paredes (cena ativa) ------------------------------
  readonly walls = computed(() => this.activeScene()?.walls ?? NO_WALLS);
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
    const doors = this.doors();
    if (!this.playerFog()) return doors;
    const polys = this.visionPolygons();
    const explored = this.explored();
    return doors.filter((d) => doorSeen(d.points, polys) || (explored && isExploredAt(explored, midpoint(d.points))));
  });

  /** Visão de jogador com névoa: a área fora da visão fica escondida. */
  readonly playerFog = computed(() => this.fogEnabled() && this.role() === 'player');

  /**
   * Tokens exibidos, por camada: na visão de jogador com névoa, só os visíveis
   * (personagens sempre aparecem).
   */
  readonly tokensByLevel = computed(() => {
    let tokens = this.resolvedTokens();
    if (this.playerFog()) {
      const polys = this.visionPolygons();
      tokens = tokens.filter((t) => t.entry.kind === 'character' || this.isVisible(t.placement, polys));
    }
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

  /**
   * Ficha que está agindo (dona das ações da barra inferior):
   * - Mestre: a ficha do token selecionado (NPC ou personagem); sem seleção, ninguém (ações gerais).
   * - Jogador: o personagem dele selecionado ou, senão, o primeiro personagem dele.
   */
  readonly actor = computed<TableEntry | null>(() => {
    const id = this.selectedTokenId();
    const selected = id ? (this.resolvedTokenById(id)?.entry ?? null) : null;
    if (this.role() === 'gm') return selected;
    if (selected?.kind === 'character' && this.ownsCharacter(selected)) return selected;
    return this.myCharacters()[0] ?? null;
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
    return !entry.ownerUserId || entry.ownerUserId === this.auth.user()?.id;
  }

  /**
   * Usa uma ação: rola os dados, registra no chat em nome de quem agiu e, se a ação
   * tiver efeito especial, deixa o efeito "na mão" (ferramenta Efeitos) para o usuário lançar.
   */
  useAction(entry: TableEntry): ActionUse {
    const config = entry.roll ?? DEFAULT_ROLL;
    const roll: RollResult = { action: entry.name, icon: entry.icon ?? 'bolt', dice: config.dice, ...rollDice(config) };
    const actor = this.actor() ?? (entry.ownerEntryId ? this.entryById().get(entry.ownerEntryId) : undefined);
    const author = actor?.name ?? this.userName();
    this.pushChat({ author, roll });

    if (entry.effect) {
      if (this.tool() !== 'fx') this.fxReturnTool = this.tool();
      this.armedFx.set({ ...entry.effect, action: entry.name });
      this.tool.set('fx');
    }
    return { author, roll, armed: !!entry.effect };
  }

  // --- Chat ----------------------------------------------------------------

  readonly chat = computed(() => this.state().chat ?? NO_MESSAGES);

  /** Envia uma mensagem de texto em nome da conta atual. */
  sendChat(text: string): void {
    const trimmed = text.trim();
    if (trimmed) this.pushChat({ author: this.userName(), text: trimmed });
  }

  clearChat(): void {
    this.patchState((s) => ({ ...s, chat: [] }));
  }

  private pushChat(message: Pick<ChatMessage, 'author' | 'text' | 'roll'>): void {
    const full: ChatMessage = { id: newId(), at: Date.now(), userId: this.auth.user()?.id ?? '', role: this.role(), ...message };
    this.patchState((s) => ({ ...s, chat: [...(s.chat ?? []), full].slice(-MAX_CHAT_MESSAGES) }));
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
    this.patchState((s) => ({ ...s, scenes: [...s.scenes, scene], activeSceneId: scene.id }));
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
    this.patchState((s) => ({ ...s, scenes: s.scenes.map((sc) => (sc.id === id ? { ...sc, ...patch } : sc)) }));
  }

  setActiveScene(id: string): void {
    this.patchState((s) => ({ ...s, activeSceneId: id }));
    this.selectedTokenId.set(null);
  }

  /** Exclui a cena e apaga os arquivos dos mapas dela (térreo e camadas). */
  removeScene(id: string): void {
    const scene = this.scenes().find((s) => s.id === id);
    this.patchState((s) => {
      const scenes = s.scenes.filter((sc) => sc.id !== id);
      const activeSceneId = s.activeSceneId === id ? (scenes[0]?.id ?? null) : s.activeSceneId;
      return { ...s, scenes, activeSceneId };
    });
    for (const blobId of [scene?.blobId, ...(scene?.levels ?? []).map((l) => l.blobId)]) {
      if (blobId) this.storage.delete(`blob:${blobId}`);
    }
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
    const names = new Set(this.sceneFolders().map((f) => f.name));
    let name = 'Nova pasta';
    for (let n = 2; names.has(name); n++) name = `Nova pasta ${n}`;
    const folder: SceneFolder = { id: newId(), name };
    this.patchState((s) => ({ ...s, sceneFolders: [...(s.sceneFolders ?? []), folder] }));
    return folder;
  }

  renameSceneFolder(id: string, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.patchState((s) => ({ ...s, sceneFolders: (s.sceneFolders ?? []).map((f) => (f.id === id ? { ...f, name: trimmed } : f)) }));
  }

  /** Exclui a pasta; as cenas dela continuam, fora de pastas. */
  removeSceneFolder(id: string): void {
    this.patchState((s) => ({
      ...s,
      sceneFolders: (s.sceneFolders ?? []).filter((f) => f.id !== id),
      scenes: s.scenes.map((sc) => (sc.folderId === id ? { ...sc, folderId: undefined } : sc)),
    }));
  }

  /** Move a cena para uma pasta (null = fora de pastas). */
  moveSceneToFolder(sceneId: string, folderId: string | null): void {
    this.updateScene(sceneId, { folderId: folderId ?? undefined });
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
    this.updateScene(scene.id, { levels: [...(scene.levels ?? []), level] });
    this.viewLevel(this.levelCount() - 1);
  }

  renameLevel(index: number, name: string): void {
    const scene = this.activeScene();
    const trimmed = name.trim();
    if (!scene || index < 1 || !trimmed) return;
    this.updateScene(scene.id, { levels: (scene.levels ?? []).map((l, i) => (i === index - 1 ? { ...l, name: trimmed } : l)) });
  }

  /** Envia (ou troca) a imagem de uma camada. O térreo usa o mapa da cena. */
  async setLevelImage(index: number, file: File): Promise<void> {
    const scene = this.activeScene();
    if (!scene) return;
    if (index === 0) return this.setSceneMap(scene.id, file);
    const old = scene.levels?.[index - 1]?.blobId;
    const blobId = newId();
    await this.storage.set(`blob:${blobId}`, file);
    this.patchLevel(scene.id, index, { blobId });
    if (old) this.storage.delete(`blob:${old}`);
  }

  /** Tira a imagem de uma camada de cima: ela vira "ar" (mostra a de baixo). */
  clearLevelImage(index: number): void {
    const scene = this.activeScene();
    const old = scene?.levels?.[index - 1]?.blobId;
    if (!scene || index < 1 || !old) return;
    this.patchLevel(scene.id, index, { blobId: undefined });
    this.storage.delete(`blob:${old}`);
  }

  /** Exclui uma camada de cima; os tokens dela descem uma camada. */
  removeLevel(index: number): void {
    const scene = this.activeScene();
    const level = scene?.levels?.[index - 1];
    if (!scene || index < 1 || !level) return;
    const shift = (n: number) => (n >= index ? n - 1 : n);
    this.updateScene(scene.id, {
      levels: (scene.levels ?? []).filter((l) => l.id !== level.id),
      tokens: (scene.tokens ?? []).map((t) => (levelOf(t) >= index ? { ...t, level: levelOf(t) - 1 } : t)),
      playerLevel: shift(scene.playerLevel ?? 0),
    });
    this.gmLevel.update(shift);
    if (level.blobId) this.storage.delete(`blob:${level.blobId}`);
  }

  /** Libera uma camada para os jogadores (é a que eles passam a ver). */
  showLevelToPlayers(index: number): void {
    const scene = this.activeScene();
    if (scene) this.updateScene(scene.id, { playerLevel: this.clampLevel(index) });
  }

  /** Sobe/desce um token de camada; se for o selecionado, a vista do mestre o acompanha. */
  moveTokenLevel(placementId: string, delta: number): void {
    const placement = this.findPlacement(placementId);
    if (!placement) return;
    const target = this.clampLevel(levelOf(placement) + delta);
    if (target === levelOf(placement)) return;
    this.patchPlacement(placementId, { level: target });
    if (this.selectedTokenId() === placementId && this.role() === 'gm') this.gmLevel.set(target);
  }

  private patchLevel(sceneId: string, index: number, patch: Partial<MapLevel>): void {
    const scene = this.scenes().find((s) => s.id === sceneId);
    if (scene) this.updateScene(sceneId, { levels: (scene.levels ?? []).map((l, i) => (i === index - 1 ? { ...l, ...patch } : l)) });
  }

  private clampLevel(level: number): number {
    return Math.min(Math.max(0, Math.round(level)), this.levelCount() - 1);
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
    this.patchState((s) => ({ ...s, entries: [...s.entries, entry] }));
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
    this.patchState((s) => ({ ...s, soundMaster: clamp01(volume) }));
  }

  updateEntry(id: string, patch: Partial<Omit<TableEntry, 'id' | 'kind'>>): void {
    this.patchState((s) => ({ ...s, entries: s.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
  }

  /** Exclui o arquivo, as ações dele, os tokens dele em todas as cenas e os arquivos (áudio/imagem). */
  removeEntry(id: string): void {
    const entry = this.entryById().get(id);
    this.patchState((s) => ({
      ...s,
      entries: s.entries.filter((e) => e.id !== id && e.ownerEntryId !== id),
      scenes: s.scenes.map((sc) =>
        sc.tokens?.some((t) => t.entryId === id) ? { ...sc, tokens: sc.tokens.filter((t) => t.entryId !== id) } : sc,
      ),
    }));
    if (entry?.blobId) this.storage.delete(`blob:${entry.blobId}`);
    if (entry?.token?.blobId) this.storage.delete(`blob:${entry.token.blobId}`);
  }

  getBlob(blobId: string): Promise<Blob | undefined> {
    return this.storage.get<Blob>(`blob:${blobId}`);
  }

  // --- Ficha de personagem -------------------------------------------------

  /** Ficha do personagem com os valores padrão dos campos ausentes (sempre 3 temas e 1+ página). */
  sheetOf(entry: TableEntry): CharacterSheet {
    const empty = defaultSheet();
    const sheet = { ...empty, ...entry.sheet };
    const themes = empty.themes.map((theme, i) => sheet.themes[i] ?? theme);
    return { ...sheet, themes: themes.slice(0, SHEET_THEME_COUNT), notes: sheet.notes.length ? sheet.notes : empty.notes };
  }

  /** Altera campos da ficha do personagem. */
  updateSheet(entryId: string, patch: Partial<CharacterSheet>): void {
    const entry = this.entryById().get(entryId);
    if (entry) this.updateEntry(entryId, { sheet: { ...this.sheetOf(entry), ...patch } });
  }

  // --- Lore da mesa (pastas e ajustes locais) -----------------------------
  // Nada aqui altera ou apaga os itens do worldbuild / Lore geral.

  /** Nome do item da lore nesta mesa (o local, se renomeado aqui). */
  loreName(item: WorldItem): string {
    return this.lore().items[item.id]?.name ?? item.name;
  }

  /** Cria uma pasta na aba Lore ("Nova pasta", "Nova pasta 2"…). */
  addLoreFolder(): LoreFolder {
    const names = new Set(this.lore().folders.map((f) => f.name));
    let name = 'Nova pasta';
    for (let n = 2; names.has(name); n++) name = `Nova pasta ${n}`;
    const folder: LoreFolder = { id: newId(), name };
    this.patchLore((l) => ({ ...l, folders: [...l.folders, folder] }));
    return folder;
  }

  renameLoreFolder(id: string, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.patchLore((l) => ({ ...l, folders: l.folders.map((f) => (f.id === id ? { ...f, name: trimmed } : f)) }));
  }

  /** Exclui a pasta da mesa; os itens dela voltam para a raiz da aba Lore. */
  removeLoreFolder(id: string): void {
    this.patchLore((l) => ({
      folders: l.folders.filter((f) => f.id !== id),
      items: Object.fromEntries(
        Object.entries(l.items).map(([itemId, o]) => [itemId, o.folderId === id ? { ...o, folderId: undefined } : o]),
      ),
    }));
  }

  /** Renomeia o item só nesta mesa (nome vazio ou igual ao original volta ao original). */
  renameLoreItem(item: WorldItem, name: string): void {
    const trimmed = name.trim();
    this.patchLoreItem(item.id, { name: trimmed && trimmed !== item.name ? trimmed : undefined });
  }

  /** Move o item para uma pasta da mesa (null = raiz). */
  moveLoreItem(itemId: string, folderId: string | null): void {
    this.patchLoreItem(itemId, { folderId: folderId ?? undefined });
  }

  /** Remove o item desta mesa (o original continua no worldbuild / Lore geral). */
  hideLoreItem(itemId: string): void {
    this.patchLoreItem(itemId, { hidden: true });
  }

  /** Traz de volta todos os itens removidos desta mesa. */
  restoreLoreItems(): void {
    this.patchLore((l) => ({
      ...l,
      items: Object.fromEntries(Object.entries(l.items).map(([id, o]) => [id, { ...o, hidden: undefined }])),
    }));
  }

  private patchLoreItem(itemId: string, patch: LoreItemOverride): void {
    this.patchLore((l) => ({ ...l, items: { ...l.items, [itemId]: { ...l.items[itemId], ...patch } } }));
  }

  private patchLore(fn: (l: TableLore) => TableLore): void {
    this.patchState((s) => ({ ...s, lore: fn(s.lore ?? EMPTY_LORE) }));
  }

  // --- Tokens: regra de vínculo --------------------------------------------

  /** Configuração do token na ficha (ou o padrão do tipo). */
  tokenOf(entry: TableEntry): TokenSettings {
    return entry.token ?? defaultToken(entry.kind);
  }

  /**
   * Configurações efetivas de um token colocado — único lugar da regra de vínculo:
   * - Personagem: tamanho, barras e etiquetas vêm sempre da ficha.
   * - NPC: usa os valores próprios da colocação (copiados ao colocar).
   * Imagem e visão vêm sempre da ficha.
   */
  resolveToken(placement: TokenPlacement, byId = this.entryById()): ResolvedToken | null {
    const entry = byId.get(placement.entryId);
    if (!entry) return null;
    const sheet = this.tokenOf(entry);
    const linked = entry.kind === 'character';
    return {
      placement,
      entry,
      linked,
      blobId: sheet.blobId,
      vision: sheet.vision,
      speed: sheet.speed ?? DEFAULT_TOKEN_SPEED,
      size: linked ? sheet.size : (placement.size ?? sheet.size),
      bars: linked ? sheet.bars : (placement.bars ?? sheet.bars),
      tags: linked ? sheet.tags : (placement.tags ?? sheet.tags),
    };
  }

  /** Token colocado (em qualquer cena) com as configurações efetivas. */
  resolvedTokenById(placementId: string): ResolvedToken | null {
    const placement = this.findPlacement(placementId);
    return placement ? this.resolveToken(placement) : null;
  }

  /**
   * Altera um token colocado respeitando a regra de vínculo:
   * personagem grava na ficha (vale para todos os tokens dele);
   * NPC grava só neste token. Visão e velocidade são sempre da ficha.
   */
  updateToken(placementId: string, patch: TokenPatch): void {
    const placement = this.findPlacement(placementId);
    const entry = placement && this.entryById().get(placement.entryId);
    if (!placement || !entry) return;

    const { vision, speed, ...own } = patch;
    if (entry.kind === 'character') {
      this.updateEntryToken(entry.id, patch);
      return;
    }
    if (vision || speed !== undefined) {
      this.updateEntryToken(entry.id, { ...(vision && { vision }), ...(speed !== undefined && { speed }) });
    }
    if (Object.keys(own).length) this.patchPlacement(placementId, own);
  }

  /** NPC: grava tamanho, barras e etiquetas deste token como padrão da ficha (próximos tokens copiam). */
  saveTokenAsDefault(placementId: string): void {
    const token = this.resolvedTokenById(placementId);
    if (!token) return;
    this.updateEntryToken(token.entry.id, {
      size: token.size,
      bars: token.bars.map((b) => ({ ...b })),
      tags: token.tags.map((t) => ({ ...t })),
    });
  }

  /** Altera a configuração de token da ficha (personagem mantém sempre as barras de status). */
  updateEntryToken(entryId: string, patch: Partial<TokenSettings>): void {
    const entry = this.entryById().get(entryId);
    if (!entry) return;
    const token = { ...this.tokenOf(entry), ...patch };
    if (entry.kind === 'character') token.bars = withStatusBars(token.bars);
    this.updateEntry(entryId, { token });
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
      // NPC: cada token colocado é independente (cópia da ficha)
      ...(entry.kind === 'npc' && {
        size: sheet.size,
        bars: sheet.bars.map((b) => ({ ...b })),
        tags: sheet.tags.map((t) => ({ ...t })),
      }),
    };
    this.updateScene(scene.id, { tokens: [...(scene.tokens ?? []), placement] });
    this.selectedTokenId.set(placement.id);
    return placement;
  }

  moveToken(placementId: string, p: Point): void {
    this.patchPlacement(placementId, { x: p.x, y: p.y });
  }

  /** Remove o token do mapa (a ficha continua). */
  removeToken(placementId: string): void {
    this.patchState((s) => ({
      ...s,
      scenes: s.scenes.map((sc) =>
        sc.tokens?.some((t) => t.id === placementId) ? { ...sc, tokens: sc.tokens.filter((t) => t.id !== placementId) } : sc,
      ),
    }));
    if (this.selectedTokenId() === placementId) this.selectedTokenId.set(null);
  }

  // --- Névoa e paredes -----------------------------------------------------

  /** Liga/desliga a névoa de guerra na cena ativa. */
  setFog(enabled: boolean): void {
    const scene = this.activeScene();
    if (scene) this.updateScene(scene.id, { fog: { ...scene.fog, enabled } });
  }

  /** Adiciona uma parede à cena ativa. */
  addWall(wall: DistributiveOmit<Wall, 'id'>): void {
    const scene = this.activeScene();
    if (scene) this.updateScene(scene.id, { walls: [...(scene.walls ?? []), { ...wall, id: newId() } as Wall] });
  }

  /** Substitui uma parede da cena ativa (mover parede ou ponto). */
  updateWall(wall: Wall): void {
    const scene = this.activeScene();
    if (scene) this.updateScene(scene.id, { walls: (scene.walls ?? []).map((w) => (w.id === wall.id ? wall : w)) });
  }

  /** Liga/desliga a memória da névoa (lembrar áreas exploradas) na cena ativa. */
  setFogMemory(memory: boolean): void {
    const scene = this.activeScene();
    if (scene) this.updateScene(scene.id, { fog: { enabled: scene.fog?.enabled ?? false, memory } });
  }

  /** Esquece as áreas exploradas da cena ativa. */
  clearExplored(): void {
    const scene = this.activeScene();
    if (scene) this.updateScene(scene.id, { explored: undefined });
  }

  /** Soma as áreas visíveis à memória da cena (só grava se algo novo foi visto). */
  private markExplored(polygons: Point[][], size: { sceneId: string; w: number; h: number }): void {
    const scene = this.activeScene();
    if (!scene || scene.id !== size.sceneId) return;
    const current = scene.explored ? decodeMask(scene.explored) : null;
    // Mapa trocado (outro tamanho): a memória recomeça
    const mask = current && maskFits(current, size.w, size.h) ? current : createMask(size.w, size.h);
    if (markPolygons(mask, polygons) || mask !== current) this.updateScene(scene.id, { explored: encodeMask(mask) });
  }

  /** Abre ou fecha uma porta (a visão é recalculada automaticamente). */
  toggleDoor(doorId: string): void {
    const door = this.doors().find((d) => d.id === doorId);
    if (door) this.updateWall({ ...door, open: !door.open });
  }

  removeWall(wallId: string): void {
    const scene = this.activeScene();
    if (scene) this.updateScene(scene.id, { walls: (scene.walls ?? []).filter((w) => w.id !== wallId) });
    if (this.selectedWallId() === wallId) this.selectedWallId.set(null);
  }

  // --- Desenhos (pincel) ---------------------------------------------------

  /** Adiciona um traço à cena ativa. */
  addStroke(stroke: Omit<Stroke, 'id'>): void {
    const scene = this.activeScene();
    if (!scene) return;
    const created: Stroke = { ...stroke, id: newId() };
    this.updateScene(scene.id, { drawings: [...(scene.drawings ?? []), created] });
    this.pushDrawAction(scene.id, { kind: 'add', strokeId: created.id });
  }

  /** Remove traços da cena ativa (borracha ou limpar tudo) — pode ser desfeito. */
  eraseStrokes(ids: string[]): void {
    const scene = this.activeScene();
    const drawings = scene?.drawings ?? [];
    const remove = new Set(ids);
    const removed = drawings.flatMap((stroke, index) => (remove.has(stroke.id) ? [{ stroke, index }] : []));
    if (!scene || !removed.length) return;
    this.updateScene(scene.id, { drawings: drawings.filter((s) => !remove.has(s.id)) });
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

    const drawings = [...(scene.drawings ?? [])];
    if (action.kind === 'add') {
      this.updateScene(scene.id, { drawings: drawings.filter((s) => s.id !== action.strokeId) });
    } else {
      // Recoloca os traços apagados nas posições originais (mantém a ordem de sobreposição)
      for (const { stroke, index } of action.removed) drawings.splice(Math.min(index, drawings.length), 0, stroke);
      this.updateScene(scene.id, { drawings });
    }
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
    const scene = this.activeScene();
    if (!scene) return null;
    const note: MapNote = { id: newId(), x: p.x, y: p.y, title: '', text: '', color: NOTE_COLORS[0], gmOnly: false };
    this.updateScene(scene.id, { notes: [...(scene.notes ?? []), note] });
    return note;
  }

  updateNote(noteId: string, patch: Partial<Omit<MapNote, 'id'>>): void {
    const scene = this.activeScene();
    if (scene) this.updateScene(scene.id, { notes: (scene.notes ?? []).map((n) => (n.id === noteId ? { ...n, ...patch } : n)) });
  }

  moveNote(noteId: string, p: Point): void {
    this.updateNote(noteId, { x: p.x, y: p.y });
  }

  removeNote(noteId: string): void {
    const scene = this.activeScene();
    if (scene) this.updateScene(scene.id, { notes: (scene.notes ?? []).filter((n) => n.id !== noteId) });
  }

  /** O ponto está em alguma área visível? (sem névoa, tudo é visível) */
  isVisible(p: Point, polys = this.visionPolygons()): boolean {
    if (!this.fogEnabled()) return true;
    return polys.some((poly) => pointInPolygon(p, poly));
  }

  private findPlacement(placementId: string): TokenPlacement | undefined {
    for (const scene of this.scenes()) {
      const found = scene.tokens?.find((t) => t.id === placementId);
      if (found) return found;
    }
    return undefined;
  }

  /** Altera um token colocado (só a cena que o contém muda de referência). */
  private patchPlacement(placementId: string, patch: Partial<Omit<TokenPlacement, 'id' | 'entryId'>>): void {
    this.patchState((s) => ({
      ...s,
      scenes: s.scenes.map((sc) =>
        sc.tokens?.some((t) => t.id === placementId)
          ? { ...sc, tokens: sc.tokens.map((t) => (t.id === placementId ? { ...t, ...patch } : t)) }
          : sc,
      ),
    }));
  }

  // --- Persistência --------------------------------------------------------

  private key(): string {
    return `table-state:${this.tableId}`;
  }

  /** Atualiza o estado e agenda a gravação (alterações seguidas viram uma só). */
  private patchState(fn: (s: TableState) => TableState): void {
    this.state.update(fn);
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 300);
  }

  /** Grava imediatamente o que estiver pendente. */
  flush(): void {
    clearTimeout(this.saveTimer);
    if (this.loaded() && this.tableId) this.storage.set(this.key(), this.state());
  }
}

// --- Leitura de dados salvos ------------------------------------------------

/**
 * Completa um estado salvo com os valores padrão dos campos novos.
 * Mesas criadas em versões antigas continuam abrindo sem erro.
 */
function normalizeState(raw: TableState | undefined): TableState {
  if (!raw) return EMPTY_STATE;
  return {
    ...raw,
    scenes: raw.scenes.map((sc) => ({
      ...sc,
      tokens: sc.tokens ?? [],
      fog: sc.fog ?? { enabled: false },
      walls: sc.walls ?? [],
      drawings: sc.drawings ?? [],
      notes: sc.notes ?? [],
    })),
    entries: raw.entries.map((e) => {
      if (e.kind === 'sound') return { ...e, volume: e.volume ?? DEFAULT_SOUND_VOLUME, loop: e.loop ?? true };
      // Personagens sempre têm as barras de status (Corpo, Mente, Espírito) no token
      if (e.kind === 'character') {
        const token = e.token ?? defaultToken('character');
        return { ...e, token: { ...token, bars: withStatusBars(token.bars) } };
      }
      return e;
    }),
  };
}

function midpoint([a, b]: Point[]): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
