import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { defaultSheet, defaultToken } from '../../../core/models/table-session.model';
import { WORLD_ITEM_META, WorldItem, WorldItemType, worldItemBlobIds } from '../../../core/models/world-item.model';
import { worldbuildKey } from '../../../core/models/world.model';
import { AuthService } from '../../../core/services/auth.service';
import { StorageService } from '../../../core/services/storage.service';
import { WorldsService } from '../../../core/services/worlds.service';
import { newId } from '../../../core/utils/id';
import { OpenWindow } from '../../../shared/services/window-manager.service';
import { LEGACY_LORE_IMPORTED_KEY, LEGACY_LORE_KEY, mergeLegacyLore } from '../utils/legacy-lore';
import { columnLayout } from '../utils/timeline-layout';

/**
 * Fonte única de dados do Worldbuild do mundo aberto (`WorldsService.activeId`) do usuário.
 *
 * Os itens formam uma árvore (parentId). A lista de itens é salva como um
 * único registro por mundo; imagens são salvas como Blobs separados
 * (chave "blob:<id>") para não pesar a lista. Trocar de mundo ou de usuário
 * grava as pendências na chave antiga antes de carregar a nova.
 */
@Injectable({ providedIn: 'root' })
export class WorldbuildService {
  private readonly storage = inject(StorageService);
  private readonly auth = inject(AuthService);
  private readonly worlds = inject(WorldsService);

  /** Nome exibido no cabeçalho do explorador: o do mundo aberto. */
  readonly title = computed(() => this.worlds.active()?.name ?? 'Worldbuild');

  // --- Estado --------------------------------------------------------------
  private readonly _items = signal<WorldItem[]>([]);
  readonly items = this._items.asReadonly();
  readonly loaded = signal(false);

  /** Acesso rápido por id. */
  readonly byId = computed(() => new Map(this._items().map((i) => [i.id, i])));

  /** Itens do mundo (tipo `item`, com cartão), em ordem alfabética. */
  readonly worldItems = computed(() => this.ofType('item'));
  /** NPCs do bestiário (fichas base), em ordem alfabética. */
  readonly worldNpcs = computed(() => this.ofType('npc'));
  /** Raças, em ordem alfabética. */
  readonly worldRaces = computed(() => this.ofType('race'));

  /**
   * Mesa de trabalho do mundo aberto (página Worldbuild): janelas abertas com posição, tamanho
   * e estado, salvas por mundo para voltarem iguais depois de recarregar a página.
   */
  readonly desk = signal<OpenWindow[]>([]);

  /** Chave do usuário cujos dados estão (ou estão sendo) carregados. */
  private storageKey: string | null = null;
  private saveTimer?: ReturnType<typeof setTimeout>;
  /** Chave da mesa de trabalho do mundo aberto e a gravação pendente dela. */
  private deskKey: string | null = null;
  private pendingDesk: OpenWindow[] | null = null;
  private deskTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    // Garante que nada se perca ao fechar ou recarregar a aba
    window.addEventListener('pagehide', () => this.flush());

    // Recarrega os itens quando o usuário ou o mundo aberto mudam (depois de a lista de mundos carregar)
    effect(() => {
      const user = this.auth.user();
      const ready = this.worlds.loaded();
      const worldId = this.worlds.activeId();
      untracked(() => {
        // Grava as pendências do mundo/usuário anterior antes de trocar a chave
        this.flush();
        this.loaded.set(false);
        this._items.set([]);
        this.desk.set([]);
        this.storageKey = user && ready ? worldbuildKey(user.id, worldId) : null;
        this.deskKey = user && ready ? `desk:${user.id}:${worldId}` : null;
        // A Lore geral antiga é importada uma vez, para o primeiro mundo
        const first = this.worlds.worlds()[0]?.id === worldId;
        if (this.storageKey && user) void this.load(this.storageKey, first ? user.id : null);
      });
    });
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
      ...(type === 'item' && { tags: [] }),
      ...(type === 'race' && { traits: [], statusMods: {} }),
      ...(type === 'npc' && { sheet: defaultSheet(), token: defaultToken('npc') }),
    };
    this._items.update((list) => [...list, item]);
    this.persist();
    this.storage.requestPersistence();
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

  /** Troca (ou define) a imagem de um item e apaga a anterior. */
  async setImage(id: string, file: File): Promise<void> {
    const old = this.byId().get(id)?.blobId;
    const blobId = newId();
    await this.storage.set(`blob:${blobId}`, file);
    this.update(id, { blobId });
    if (old) this.storage.delete(`blob:${old}`);
  }

  /** Troca (ou define) a imagem padrão masculina/feminina de uma Raça e apaga a anterior. */
  async setRaceImage(id: string, field: 'maleBlobId' | 'femaleBlobId', file: File): Promise<void> {
    const old = this.byId().get(id)?.[field];
    const blobId = await this.storeBlob(file);
    this.update(id, { [field]: blobId });
    if (old) this.deleteBlob(old);
  }

  /** Tira a imagem padrão masculina/feminina de uma Raça (e apaga o arquivo). */
  clearRaceImage(id: string, field: 'maleBlobId' | 'femaleBlobId'): void {
    const old = this.byId().get(id)?.[field];
    if (!old) return;
    this.update(id, { [field]: undefined });
    this.deleteBlob(old);
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

    // Limpa os arquivos de imagem associados (inclui imagem e inventário dos NPCs e imagens das raças)
    for (const item of removed) {
      for (const blobId of worldItemBlobIds(item)) this.storage.delete(`blob:${blobId}`);
    }
    return [...ids];
  }

  /** Grava um arquivo (imagem) e devolve o id dele. */
  async storeBlob(file: Blob): Promise<string> {
    const blobId = newId();
    await this.storage.set(`blob:${blobId}`, file);
    return blobId;
  }

  deleteBlob(blobId: string): void {
    this.storage.delete(`blob:${blobId}`);
  }

  // --- Internos ------------------------------------------------------------

  private ofType(type: WorldItemType): WorldItem[] {
    return this._items()
      .filter((i) => i.type === type)
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }));
  }

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
    const base = {
      folder: 'Nova pasta',
      document: 'Novo documento',
      timeline: 'Nova linha do tempo',
      image: WORLD_ITEM_META.image.label,
      item: 'Novo item',
      npc: 'Novo NPC',
      race: 'Nova raça',
    }[type];
    const siblings = new Set(this.childrenOf(parentId).map((i) => i.name));
    let name = base;
    for (let n = 2; siblings.has(name); n++) name = `${base} ${n}`;
    return name;
  }

  /** Carrega os itens da chave. `importLoreFor`: usuário que recebe a Lore geral antiga, se ainda não foi importada. */
  private async load(key: string, importLoreFor: string | null): Promise<void> {
    const deskKey = this.deskKey;
    let items = ((await this.storage.get<WorldItem[]>(key)) ?? []).map(migrateTimeline);
    if (importLoreFor) items = await this.importLegacyLore(items, importLoreFor, key);
    const desk = deskKey ? ((await this.storage.get<OpenWindow[]>(deskKey)) ?? []) : [];
    // O usuário ou o mundo mudou durante o carregamento: descarta o resultado antigo
    if (key !== this.storageKey) return;
    this._items.set(items);
    this.desk.set(desk);
    this.loaded.set(true);
  }

  /** Guarda as janelas abertas na mesa de trabalho do mundo (gravação agrupada, como os itens). */
  saveDesk(windows: OpenWindow[]): void {
    if (!this.loaded() || !this.deskKey) return;
    this.pendingDesk = windows;
    clearTimeout(this.deskTimer);
    this.deskTimer = setTimeout(() => this.flushDesk(), 300);
  }

  private flushDesk(): void {
    clearTimeout(this.deskTimer);
    if (this.pendingDesk && this.deskKey) this.storage.set(this.deskKey, this.pendingDesk);
    this.pendingDesk = null;
  }

  /**
   * A Lore geral foi removida do app: o conteúdo dela (chave `lore:global`) entra uma única vez
   * no primeiro mundo do primeiro usuário que abrir o app, numa pasta "Lore geral (importada)".
   * Os ids são mantidos, então NPCs, itens e raças usados pelas mesas continuam funcionando.
   * A chave antiga fica intacta, como cópia de segurança.
   */
  private async importLegacyLore(items: WorldItem[], userId: string, key: string): Promise<WorldItem[]> {
    if (await this.storage.get(LEGACY_LORE_IMPORTED_KEY)) return items;
    const lore = (await this.storage.get<WorldItem[]>(LEGACY_LORE_KEY)) ?? [];
    const merged = mergeLegacyLore(items, lore.map(migrateTimeline), { id: newId(), now: Date.now() });
    // Grava na chave do mundo que estava sendo carregado (mesmo que o usuário já tenha trocado)
    if (merged !== items) await this.storage.set(key, merged);
    await this.storage.set(LEGACY_LORE_IMPORTED_KEY, userId);
    return merged;
  }

  /**
   * Agenda o salvamento da lista (metadados e textos).
   * Várias alterações seguidas (ex.: digitação) viram uma única gravação.
   */
  private persist(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 300);
  }

  /** Grava imediatamente o que estiver pendente (itens e mesa de trabalho). */
  private flush(): void {
    clearTimeout(this.saveTimer);
    if (this.loaded() && this.storageKey) this.storage.set(this.storageKey, this._items());
    this.flushDesk();
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
