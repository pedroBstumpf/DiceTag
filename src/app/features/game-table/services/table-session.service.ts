import { Injectable, computed, inject, signal } from '@angular/core';
import {
  Scene,
  TABLE_ENTRY_META,
  TableEntry,
  TableEntryKind,
  TableRole,
  TableState,
  TableTool,
} from '../../../core/models/table-session.model';
import { StorageService } from '../../../core/services/storage.service';
import { newId } from '../../../core/utils/id';

/** Barras da mesa que podem ser escondidas. */
export interface TablePanels {
  scenes: boolean;
  tools: boolean;
  side: boolean;
  actions: boolean;
}

const EMPTY_STATE: TableState = { scenes: [], activeSceneId: null, entries: [] };

/**
 * Estado da mesa aberta: cenas, arquivos (fichas, sons, automações),
 * ferramenta ativa e papel do usuário (mestre ou jogador).
 *
 * Fornecido no componente da mesa — cada mesa aberta tem sua instância.
 * Salva no IndexedDB com a chave "table-state:<id>".
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

  // --- Estado da sessão (não persistido) -----------------------------------
  readonly tool = signal<TableTool>('select');
  readonly role = signal<TableRole>('gm');

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
    this.state.set((await this.storage.get<TableState>(this.key())) ?? EMPTY_STATE);
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
    };
    this.patchState((s) => ({ ...s, scenes: [...s.scenes, scene], activeSceneId: scene.id }));
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
  }

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
    return this.addEntry('sound', { name: file.name.replace(/\.[^.]+$/, ''), blobId });
  }

  updateEntry(id: string, patch: Partial<Omit<TableEntry, 'id' | 'kind'>>): void {
    this.patchState((s) => ({ ...s, entries: s.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
  }

  removeEntry(id: string): void {
    const entry = this.entryById().get(id);
    this.patchState((s) => ({ ...s, entries: s.entries.filter((e) => e.id !== id) }));
    if (entry?.blobId) this.storage.delete(`blob:${entry.blobId}`);
  }

  getBlob(blobId: string): Promise<Blob | undefined> {
    return this.storage.get<Blob>(`blob:${blobId}`);
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
