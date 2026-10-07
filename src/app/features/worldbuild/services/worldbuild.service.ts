import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { User } from '../../../core/models/user.model';
import { WORLD_ITEM_META, WorldItem, WorldItemType } from '../../../core/models/world-item.model';
import { AuthService } from '../../../core/services/auth.service';
import { StorageService } from '../../../core/services/storage.service';
import { newId } from '../../../core/utils/id';
import { columnLayout } from '../utils/timeline-layout';

/**
 * Fonte única de dados do worldbuild do usuário logado.
 *
 * Os itens formam uma árvore (parentId). A lista de itens é salva como um
 * único registro por usuário; imagens são salvas como Blobs separados
 * (chave "blob:<id>") para não pesar a lista.
 *
 * Também é a base do LoreService (Lore geral): a subclasse só troca o título
 * e a chave de armazenamento, e todos os editores funcionam com as duas.
 */
@Injectable({ providedIn: 'root' })
export class WorldbuildService {
  private readonly storage = inject(StorageService);
  private readonly auth = inject(AuthService);

  /** Nome exibido no cabeçalho do explorador. */
  readonly title: string = 'Worldbuild';

  // --- Estado --------------------------------------------------------------
  private readonly _items = signal<WorldItem[]>([]);
  readonly items = this._items.asReadonly();
  readonly loaded = signal(false);

  /** Acesso rápido por id. */
  readonly byId = computed(() => new Map(this._items().map((i) => [i.id, i])));

  /** Chave do usuário cujos dados estão (ou estão sendo) carregados. */
  private storageKey: string | null = null;
  private saveTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    // Garante que nada se perca ao fechar ou recarregar a aba
    window.addEventListener('pagehide', () => this.flush());

    // Recarrega o worldbuild quando o usuário muda
    effect(() => {
      const user = this.auth.user();
      untracked(() => {
        // Grava as pendências do usuário anterior antes de trocar a chave
        this.flush();
        this.loaded.set(false);
        this._items.set([]);
        this.storageKey = this.keyFor(user);
        if (this.storageKey) this.load(this.storageKey);
      });
    });
  }

  /** Chave do IndexedDB onde ficam os itens (por usuário; null = ninguém logado). */
  protected keyFor(user: User | null): string | null {
    return user ? `worldbuild:${user.id}` : null;
  }

  // --- Consultas -----------------------------------------------------------

  /** Filhos diretos de uma pasta (pastas primeiro, depois ordem alfabética). */
  childrenOf(parentId: string | null): WorldItem[] {
    return this._items()
      .filter((i) => i.parentId === parentId)
      .sort((a, b) =>
        a.type === 'folder' && b.type !== 'folder' ? -1
        : b.type === 'folder' && a.type !== 'folder' ? 1
        : a.name.localeCompare(b.name, 'pt-BR', { numeric: true }),
      );
  }

  /** true se `id` está dentro (em qualquer nível) da pasta `ancestorId`. */
  isDescendant(id: string, ancestorId: string): boolean {
    let current = this.byId().get(id);
    while (current?.parentId) {
      if (current.parentId === ancestorId) return true;
      current = this.byId().get(current.parentId);
    }
    return false;
  }

  /** Lê o arquivo de uma imagem. */
  getBlob(blobId: string): Promise<Blob | undefined> {
    return this.storage.get<Blob>(`blob:${blobId}`);
  }

  // --- Criação -------------------------------------------------------------

  /** Cria um item vazio do tipo pedido. */
  create(type: WorldItemType, parentId: string | null = null, name?: string): WorldItem {
    const now = Date.now();
    const item: WorldItem = {
      id: newId(),
      type,
      parentId,
      name: name ?? this.defaultName(type, parentId),
      createdAt: now,
      updatedAt: now,
      ...(type === 'document' && { content: '' }),
      ...(type === 'timeline' && { events: [], links: [] }),
    };
    this._items.update((list) => [...list, item]);
    this.persist();
    return item;
  }

  /** Envia uma imagem/mapa e cria o item correspondente. */
  async uploadImage(file: File, parentId: string | null = null): Promise<WorldItem> {
    const blobId = newId();
    await this.storage.set(`blob:${blobId}`, file);

    const item = this.create('image', parentId, file.name.replace(/\.[^.]+$/, ''));
    this.update(item.id, { blobId });
    return { ...item, blobId };
  }

  // --- Edição --------------------------------------------------------------

  /** Atualiza campos de um item (e marca a data de edição). */
  update(id: string, patch: Partial<Omit<WorldItem, 'id' | 'type'>>): void {
    this._items.update((list) =>
      list.map((i) => (i.id === id ? { ...i, ...patch, updatedAt: Date.now() } : i)),
    );
    this.persist();
  }

  rename(id: string, name: string): void {
    const trimmed = name.trim();
    if (trimmed) this.update(id, { name: trimmed });
  }

  /** Move um item para outra pasta (ou raiz). Impede ciclos. */
  move(id: string, parentId: string | null): boolean {
    if (id === parentId) return false;
    if (parentId && this.isDescendant(parentId, id)) return false;
    if (this.byId().get(id)?.parentId === parentId) return false;
    this.update(id, { parentId });
    return true;
  }

  /** Exclui um item e, se for pasta, todo o seu conteúdo. Retorna os ids removidos. */
  remove(id: string): string[] {
    const ids = this.collectTree(id);
    const removed = this._items().filter((i) => ids.has(i.id));

    this._items.update((list) => list.filter((i) => !ids.has(i.id)));
    this.persist();

    // Limpa os arquivos de imagem associados
    removed.filter((i) => i.blobId).forEach((i) => this.storage.delete(`blob:${i.blobId}`));
    return [...ids];
  }

  // --- Internos ------------------------------------------------------------

  /** id + todos os descendentes. */
  private collectTree(rootId: string): Set<string> {
    const ids = new Set([rootId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const item of this._items()) {
        if (item.parentId && ids.has(item.parentId) && !ids.has(item.id)) {
          ids.add(item.id);
          grew = true;
        }
      }
    }
    return ids;
  }

  /** "Novo documento", "Novo documento 2"… sem repetir nomes na mesma pasta. */
  private defaultName(type: WorldItemType, parentId: string | null): string {
    const base = { folder: 'Nova pasta', document: 'Novo documento', timeline: 'Nova linha do tempo', image: WORLD_ITEM_META.image.label }[type];
    const siblings = new Set(this.childrenOf(parentId).map((i) => i.name));
    let name = base;
    for (let n = 2; siblings.has(name); n++) name = `${base} ${n}`;
    return name;
  }

  private async load(key: string): Promise<void> {
    const items = (await this.storage.get<WorldItem[]>(key)) ?? [];
    // O usuário mudou durante o carregamento: descarta o resultado antigo
    if (key !== this.storageKey) return;
    this._items.set(items.map(migrateTimeline));
    this.loaded.set(true);
  }

  /**
   * Agenda o salvamento da lista (metadados e textos).
   * Várias alterações seguidas (ex.: digitação) viram uma única gravação.
   */
  private persist(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 300);
  }

  /** Grava imediatamente o que estiver pendente. */
  private flush(): void {
    clearTimeout(this.saveTimer);
    if (this.loaded() && this.storageKey) this.storage.set(this.storageKey, this._items());
  }
}

// --- Migração de dados antigos ----------------------------------------------

/**
 * Linhas do tempo antigas (lista vertical) viram mapa mental:
 * eventos sem posição são empilhados em coluna e, se a linha ainda não tinha
 * conexões, cada evento é ligado ao seguinte (preserva a ordem original).
 * Único ponto de migração do worldbuild — aplicado ao carregar.
 */
function migrateTimeline(item: WorldItem): WorldItem {
  if (item.type !== 'timeline') return item;
  const events = item.events ?? [];
  const needsPositions = events.some((e) => e.x === undefined || e.y === undefined);
  if (!needsPositions && item.links) return item;

  const column = columnLayout(events.length);
  return {
    ...item,
    events: events.map((e, i) => (e.x === undefined || e.y === undefined ? { ...e, ...column[i] } : e)),
    links:
      item.links ??
      events.slice(1).map((e, i) => ({ id: newId(), from: events[i].id, to: e.id })),
  };
}
