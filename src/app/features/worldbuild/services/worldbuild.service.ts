import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { defaultSheet, defaultToken } from '../../../core/models/table-session.model';
import { WORLD_ITEM_META, WorldItem, WorldItemType, worldItemBlobIds } from '../../../core/models/world-item.model';
import { worldbuildKey } from '../../../core/models/world.model';
import { AuthService } from '../../../core/services/auth.service';
import { FileStore, LocalFileStore } from '../../../core/services/file-store';
import { ServerApiService, ServerError } from '../../../core/services/server-api.service';
import { ServerFileStore } from '../../../core/services/server-file-store';
import { StorageService } from '../../../core/services/storage.service';
import { WorldsService } from '../../../core/services/worlds.service';
import { newId } from '../../../core/utils/id';
import { OpenWindow } from '../../../shared/services/window-manager.service';
import { columnLayout } from '../utils/timeline-layout';

/** Ordem da árvore: pastas primeiro, depois nome (pt-BR, numérico). */
export function byTreeOrder(a: WorldItem, b: WorldItem): number {
  if (a.type === 'folder' && b.type !== 'folder') return -1;
  if (b.type === 'folder' && a.type !== 'folder') return 1;
  return a.name.localeCompare(b.name, 'pt-BR', { numeric: true });
}

/** Mundo do servidor aberto: o da mesa online ou o que o mestre prepara na página Worldbuild. */
export interface OnlineWorld {
  worldId: string;
  /** Mesa online aberta (o jogador lê a Lore por ela; quem controla um NPC grava por ela). */
  tableId?: string;
  /** Dono do mundo: lê e grava tudo. Os demais recebem só o que o servidor libera. */
  canEdit: boolean;
}

/** Espera para agrupar edições antes de gravar no servidor (no navegador: 300 ms). */
const ONLINE_SAVE_MS = 1000;
/** Espera antes de tentar de novo uma gravação que falhou por conexão ou limite de taxa. */
const ONLINE_RETRY_MS = 5000;
/** Acima disto, o navegador recusa gravações com `keepalive` (página fechando). */
const KEEPALIVE_MAX_BYTES = 60_000;

/**
 * Fonte única de dados do Worldbuild aberto. Duas origens, com a mesma interface para as telas:
 *
 * - **Navegador** (padrão): o mundo aberto do usuário (`WorldsService.activeId`), salvo no IndexedDB
 *   como um único registro por mundo; trocar de mundo ou de usuário grava as pendências na chave
 *   antiga antes de carregar a nova.
 * - **Servidor** (`openOnline`): o mundo da mesa online. Cada item alterado é gravado sozinho
 *   (agrupado por `ONLINE_SAVE_MS`). O jogador recebe só o que o servidor projeta para ele e busca
 *   de novo quando o mundo muda (`refreshOnline`).
 *
 * Os itens formam uma árvore (parentId). Imagens ficam à parte (`FileStore`), para não pesar a lista.
 */
@Injectable({ providedIn: 'root' })
export class WorldbuildService {
  private readonly storage = inject(StorageService);
  private readonly auth = inject(AuthService);
  private readonly worlds = inject(WorldsService);
  private readonly api = inject(ServerApiService);
  private readonly localFiles = inject(LocalFileStore);

  // --- Origem: navegador ou servidor ---------------------------------------
  /** Mundo do servidor aberto (null = o mundo deste navegador). */
  readonly online = signal<OnlineWorld | null>(null);
  /** Nome do mundo do servidor (o jogador vê só "Lore"). */
  private readonly onlineName = signal('');
  /** Onde ficam as imagens do mundo aberto. */
  private files: FileStore = this.localFiles;
  /** Problema ao falar com o servidor, para a página mostrar. */
  readonly notice = signal<{ text: string } | null>(null);
  /** Itens alterados e excluídos ainda não enviados. */
  private readonly dirty = new Set<string>();
  private readonly deleted = new Set<string>();
  /** Fila de gravações: uma de cada vez, na ordem. */
  private writes: Promise<void> = Promise.resolve();
  /** Número do último carregamento: resposta atrasada de um anterior é descartada. */
  private loadSeq = 0;
  private refreshTimer?: ReturnType<typeof setTimeout>;

  /** Nome exibido no cabeçalho do explorador: o do mundo aberto. */
  readonly title = computed(() => (this.online() ? this.onlineName() : (this.worlds.active()?.name ?? 'Worldbuild')));

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
    window.addEventListener('pagehide', () => this.flush(true));

    // Recarrega os itens quando o usuário ou o mundo aberto mudam (depois de a lista de mundos carregar)
    effect(() => {
      const user = this.auth.user();
      const ready = this.worlds.loaded();
      const worldId = this.worlds.activeId();
      const online = this.online();
      untracked(() => {
        // Grava as pendências do mundo/usuário anterior antes de trocar a chave
        this.flush();
        this.loaded.set(false);
        this._items.set([]);
        this.desk.set([]);
        this.files = online ? new ServerFileStore(this.api, { worldId: online.worldId }) : this.localFiles;
        if (online) {
          this.storageKey = null;
          // A mesa de trabalho é uma preferência deste navegador, mesmo com o mundo no servidor
          this.deskKey = online.canEdit ? `desk:servidor:${online.worldId}` : null;
          void this.loadOnline(online);
          return;
        }
        this.storageKey = user && ready ? worldbuildKey(user.id, worldId) : null;
        this.deskKey = user && ready ? `desk:${user.id}:${worldId}` : null;
        if (this.storageKey) void this.load(this.storageKey);
      });
    });
  }

  // --- Mundo do servidor -----------------------------------------------------

  /** Passa a usar um mundo do servidor. O mundo deste navegador fica guardado, sem mudança. */
  openOnline(world: OnlineWorld): void {
    const current = this.online();
    if (current?.worldId === world.worldId && current.tableId === world.tableId && current.canEdit === world.canEdit) return;
    this.flush();
    this.loaded.set(false);
    this._items.set([]);
    this.online.set(world);
  }

  /** Volta ao mundo deste navegador, gravando antes o que falta enviar. */
  closeOnline(): void {
    if (!this.online()) return;
    clearTimeout(this.refreshTimer);
    this.flush();
    this.loaded.set(false);
    this._items.set([]);
    this.online.set(null);
  }

  /** Jogador: busca de novo o que pode ver (o mundo mudou ou o mestre revelou algo). */
  refreshOnline(): void {
    const world = this.online();
    if (!world || world.canEdit) return;
    // Mudanças seguidas (revelar várias pastas) viram uma busca só
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.loadOnline(world), 200);
  }

  /** Lê os itens do servidor: o dono, o mundo inteiro; os demais, a Lore projetada da mesa. */
  private async loadOnline(world: OnlineWorld): Promise<void> {
    const seq = ++this.loadSeq;
    try {
      const path = world.canEdit ? `/worlds/${encodeURIComponent(world.worldId)}/items` : `/tables/${encodeURIComponent(world.tableId ?? '')}/lore`;
      const { items } = await this.api.get<{ items: WorldItem[] }>(path);
      const name = world.canEdit ? (await this.api.get<{ worlds: { id: string; name: string }[] }>('/worlds')).worlds.find((w) => w.id === world.worldId)?.name : 'Lore';
      const deskKey = this.deskKey;
      const desk = deskKey ? ((await this.storage.get<OpenWindow[]>(deskKey)) ?? []) : [];
      // Outro carregamento começou, ou o mundo mudou no meio: descarta
      if (seq !== this.loadSeq || this.online() !== world) return;
      this.onlineName.set(name ?? 'Mundo');
      // Alterações ainda não enviadas continuam valendo sobre o que veio do servidor
      const pending = new Map(this._items().filter((i) => this.dirty.has(i.id)).map((i) => [i.id, i]));
      const fresh = items.map(migrateTimeline).map((i) => pending.get(i.id) ?? i);
      this._items.set(fresh.filter((i) => !this.deleted.has(i.id)));
      if (!this.loaded()) this.desk.set(desk);
      this.loaded.set(true);
    } catch (error) {
      if (seq === this.loadSeq && this.online() === world) this.notice.set({ text: `Mundo não carregado: ${messageOf(error)}` });
    }
  }

  /** Envia o que falta ao servidor. `closing`: a página está fechando, então vai tudo de uma vez. */
  private flushOnline(world: OnlineWorld, closing = false): void {
    const byId = this.byId();
    const items = [...this.dirty].flatMap((id) => byId.get(id) ?? []);
    const removed = [...this.deleted];
    this.dirty.clear();
    this.deleted.clear();
    if (!items.length && !removed.length) return;
    if (closing) {
      for (const item of items) void this.saveOnline(world, item, true).catch(() => undefined);
    }
    // Uma gravação por vez: a ordem das edições de um mesmo item é a da fila
    this.writes = this.writes.then(async () => {
      if (!closing) for (const item of items) await this.sendItem(world, item);
      if (removed.length) await this.sendRemoved(world, removed);
    });
  }

  private async sendItem(world: OnlineWorld, item: WorldItem): Promise<void> {
    try {
      await this.saveOnline(world, item);
    } catch (error) {
      this.notice.set({ text: `"${item.name}" não foi salvo: ${messageOf(error)}` });
      if (isTemporary(error) && this.online() === world) {
        this.dirty.add(item.id);
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.flush(), ONLINE_RETRY_MS);
      }
    }
  }

  /** Dono: o item inteiro. Quem controla o NPC: só o que o servidor aceita dele (ficha, barras, ações). */
  private saveOnline(world: OnlineWorld, item: WorldItem, closing = false): Promise<unknown> {
    if (world.canEdit) {
      const keepalive = closing && JSON.stringify(item).length < KEEPALIVE_MAX_BYTES;
      return this.api.put(`/worlds/${encodeURIComponent(world.worldId)}/items/${encodeURIComponent(item.id)}`, item, keepalive);
    }
    if (item.type !== 'npc' || !world.tableId) return Promise.resolve();
    const body = { sheet: item.sheet, bars: item.token?.bars, tags: item.token?.tags, abilities: item.abilities };
    const keepalive = closing && JSON.stringify(body).length < KEEPALIVE_MAX_BYTES;
    return this.api.patch(`/tables/${encodeURIComponent(world.tableId)}/npcs/${encodeURIComponent(item.id)}`, body, keepalive);
  }

  private async sendRemoved(world: OnlineWorld, ids: string[]): Promise<void> {
    if (!world.canEdit) return;
    await this.api.post(`/worlds/${encodeURIComponent(world.worldId)}/items/delete`, { ids }).catch((error: unknown) => {
      this.notice.set({ text: `Exclusão não gravada: ${messageOf(error)}` });
      if (isTemporary(error) && this.online() === world) {
        for (const id of ids) this.deleted.add(id);
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.flush(), ONLINE_RETRY_MS);
      }
    });
  }

  // --- Consultas -----------------------------------------------------------

  /** Filhos diretos de uma pasta (pastas primeiro, depois ordem alfabética). */
  childrenOf(parentId: string | null): WorldItem[] {
    return this._items()
      .filter((i) => i.parentId === parentId)
      .sort(byTreeOrder);
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
    return this.files.get(blobId);
  }

  /** Onde ficam as imagens do mundo aberto (para outra fonte de ficha gravar no mesmo lugar). */
  get fileStore(): FileStore {
    return this.files;
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
    this.dirty.add(item.id);
    this.persist();
    this.storage.requestPersistence();
    return item;
  }

  /** Envia uma imagem/mapa e cria o item correspondente. */
  async uploadImage(file: File, parentId: string | null = null): Promise<WorldItem> {
    const blobId = await this.storeBlob(file);

    const item = this.create('image', parentId, file.name.replace(/\.[^.]+$/, ''));
    this.update(item.id, { blobId });
    return { ...item, blobId };
  }

  /** Troca (ou define) a imagem de um item e apaga a anterior. */
  async setImage(id: string, file: File): Promise<void> {
    const old = this.byId().get(id)?.blobId;
    const blobId = await this.storeBlob(file);
    this.update(id, { blobId });
    if (old) this.deleteBlob(old);
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
    this.dirty.add(id);
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
    for (const removedId of ids) {
      this.dirty.delete(removedId);
      this.deleted.add(removedId);
    }
    this.persist();

    // Limpa os arquivos de imagem associados (inclui imagem e inventário dos NPCs e imagens das raças)
    for (const item of removed) {
      for (const blobId of worldItemBlobIds(item)) this.deleteBlob(blobId);
    }
    return [...ids];
  }

  /** Grava um arquivo (imagem) e devolve o id dele. */
  async storeBlob(file: Blob): Promise<string> {
    try {
      return await this.files.put(file);
    } catch (error) {
      this.notice.set({ text: `Arquivo não enviado: ${messageOf(error)}` });
      throw error;
    }
  }

  deleteBlob(blobId: string): void {
    void this.files.remove(blobId);
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

  /** Carrega os itens e a mesa de trabalho do mundo. */
  private async load(key: string): Promise<void> {
    const deskKey = this.deskKey;
    const items = ((await this.storage.get<WorldItem[]>(key)) ?? []).map(migrateTimeline);
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
   * Agenda o salvamento da lista (metadados e textos).
   * Várias alterações seguidas (ex.: digitação) viram uma única gravação.
   */
  private persist(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), this.online() ? ONLINE_SAVE_MS : 300);
  }

  /** Grava imediatamente o que estiver pendente (itens e mesa de trabalho). */
  private flush(closing = false): void {
    clearTimeout(this.saveTimer);
    const world = this.online();
    if (world) {
      this.flushOnline(world, closing);
    } else {
      this.dirty.clear();
      this.deleted.clear();
      if (this.loaded() && this.storageKey) this.storage.set(this.storageKey, this._items());
    }
    this.flushDesk();
  }
}

/** Mensagem pronta para a tela. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'erro desconhecido.';
}

/** Falha que pode passar sozinha (sem conexão, limite de taxa, servidor reiniciando): vale tentar de novo. */
function isTemporary(error: unknown): boolean {
  return error instanceof ServerError && (error.status === 0 || error.status === 429 || error.status >= 500);
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
