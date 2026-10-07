import { Injectable, computed, inject, signal } from '@angular/core';
import { Point } from '../../../core/models/geometry.model';
import {
  DEFAULT_SOUND_VOLUME,
  METERS_PER_SQUARE,
  Scene,
  TABLE_ENTRY_META,
  TableEntry,
  TableEntryKind,
  TableRole,
  TableState,
  TableTool,
  TokenBar,
  TokenPlacement,
  TokenSettings,
  TokenTag,
  TokenVision,
  Wall,
  defaultToken,
} from '../../../core/models/table-session.model';
import { StorageService } from '../../../core/services/storage.service';
import { newId } from '../../../core/utils/id';
import { computeVisibilityPolygon, pointInPolygon, wallsToSegments } from '../utils/visibility';

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
  bars: TokenBar[];
  tags: TokenTag[];
}

/** Campos do token editáveis pela ficha ou pela janela "Token". */
export type TokenPatch = Partial<Pick<TokenSettings, 'size' | 'vision' | 'bars' | 'tags'>>;

/** Modo da ferramenta Névoa. */
export type WallMode = 'line' | 'circle' | 'erase';

/** Omit que preserva cada membro de uma união (ex.: Wall sem o id). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

const EMPTY_STATE: TableState = { scenes: [], activeSceneId: null, entries: [] };
const NO_TOKENS: TokenPlacement[] = [];
const NO_WALLS: Wall[] = [];

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

  /** Tokens colocados na cena ativa (mesma referência enquanto não mudam). */
  readonly tokens = computed(() => this.activeScene()?.tokens ?? NO_TOKENS);
  /** Tokens da cena ativa com as configurações efetivas. */
  readonly resolvedTokens = computed(() => {
    const byId = this.entryById();
    return this.tokens().flatMap((p) => this.resolveToken(p, byId) ?? []);
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
      return this.resolvedTokens()
        .filter((t) => t.vision.enabled)
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

  /** Visão de jogador com névoa: a área fora da visão fica escondida. */
  readonly playerFog = computed(() => this.fogEnabled() && this.role() === 'player');

  /** Tokens exibidos: na visão de jogador com névoa, só os visíveis (personagens sempre aparecem). */
  readonly visibleTokens = computed(() => {
    const tokens = this.resolvedTokens();
    if (!this.playerFog()) return tokens;
    const polys = this.visionPolygons();
    return tokens.filter((t) => t.entry.kind === 'character' || this.isVisible(t.placement, polys));
  });

  // --- Estado da sessão (não persistido) -----------------------------------
  readonly tool = signal<TableTool>('select');
  readonly role = signal<TableRole>('gm');
  /** Token selecionado no mapa (anel azul). */
  readonly selectedTokenId = signal<string | null>(null);
  /** Modo da ferramenta Névoa: desenhar parede em linha, em círculo ou apagar. */
  readonly wallMode = signal<WallMode>('line');
  /** Mestre: mostrar paredes mesmo fora da ferramenta Névoa. */
  readonly showWallsAlways = signal(false);
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

  /** Automações do papel atual (barra inferior). */
  readonly hotbar = computed(() =>
    this.entries().filter((e) => e.kind === 'automation' && e.role === this.role()),
  );

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

  /** Exclui a cena e apaga o arquivo do mapa dela. */
  removeScene(id: string): void {
    const scene = this.scenes().find((s) => s.id === id);
    this.patchState((s) => {
      const scenes = s.scenes.filter((sc) => sc.id !== id);
      const activeSceneId = s.activeSceneId === id ? (scenes[0]?.id ?? null) : s.activeSceneId;
      return { ...s, scenes, activeSceneId };
    });
    if (scene?.blobId) this.storage.delete(`blob:${scene.blobId}`);
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
      ...(kind === 'automation' && { role: this.role(), icon: 'bolt' }),
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

  /** Exclui o arquivo, os tokens dele em todas as cenas e os arquivos (áudio/imagem). */
  removeEntry(id: string): void {
    const entry = this.entryById().get(id);
    this.patchState((s) => ({
      ...s,
      entries: s.entries.filter((e) => e.id !== id),
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
   * NPC grava só neste token. A visão é sempre da ficha.
   */
  updateToken(placementId: string, patch: TokenPatch): void {
    const placement = this.findPlacement(placementId);
    const entry = placement && this.entryById().get(placement.entryId);
    if (!placement || !entry) return;

    const { vision, ...own } = patch;
    if (entry.kind === 'character') {
      this.updateEntryToken(entry.id, patch);
      return;
    }
    if (vision) this.updateEntryToken(entry.id, { vision });
    if (Object.keys(own).length) this.patchPlacement(placementId, own);
  }

  /** Altera a configuração de token da ficha (janela do personagem/NPC). */
  updateEntryToken(entryId: string, patch: Partial<TokenSettings>): void {
    const entry = this.entryById().get(entryId);
    if (entry) this.updateEntry(entryId, { token: { ...this.tokenOf(entry), ...patch } });
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
    if (scene) this.updateScene(scene.id, { fog: { enabled } });
  }

  /** Adiciona uma parede à cena ativa. */
  addWall(wall: DistributiveOmit<Wall, 'id'>): void {
    const scene = this.activeScene();
    if (scene) this.updateScene(scene.id, { walls: [...(scene.walls ?? []), { ...wall, id: newId() } as Wall] });
  }

  removeWall(wallId: string): void {
    const scene = this.activeScene();
    if (scene) this.updateScene(scene.id, { walls: (scene.walls ?? []).filter((w) => w.id !== wallId) });
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
    })),
    entries: raw.entries.map((e) =>
      e.kind === 'sound' ? { ...e, volume: e.volume ?? DEFAULT_SOUND_VOLUME, loop: e.loop ?? true } : e,
    ),
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
