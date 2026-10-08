import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { WORLD_ITEM_META, WorldItem } from '../../../../core/models/world-item.model';
import { LoreFolder, TABLE_ENTRY_META, TableEntry, TableEntryKind, hasSheet } from '../../../../core/models/table-session.model';
import { AutoFocus } from '../../../../shared/directives/auto-focus.directive';
import { LoreService } from '../../../worldbuild/services/lore.service';
import { WorldbuildService } from '../../../worldbuild/services/worldbuild.service';
import { BlobUrlService } from '../../services/blob-url.service';
import { TableSessionService } from '../../services/table-session.service';
import { TOKEN_DRAG_TYPE } from '../map-layers/tokens-layer/tokens-layer';
import { ChatPanel } from '../chat-panel/chat-panel';
import { SoundList } from '../sound-list/sound-list';

/** Abas do painel lateral direito. */
type PanelTab = 'chat' | 'sheets' | 'lore' | 'sounds' | 'automations';

/** Id da janela que mostra as pastas do worldbuild dentro da mesa. */
export const WORLDBUILD_WINDOW = 'worldbuild:explorer';
/** Id da janela que mostra as pastas da Lore geral dentro da mesa. */
export const LORE_WINDOW = 'lore:explorer';

/** Item da aba Lore com o nome desta mesa. */
interface LoreRow {
  item: WorldItem;
  name: string;
  /** Vem da Lore geral (e não do worldbuild do usuário). */
  global: boolean;
}

/**
 * Painel lateral direito da mesa, com abas:
 * - Chat: mensagens e resultados das rolagens
 * - Fichas: personagens e NPCs
 * - Lore: documentos, linhas do tempo e mapas do worldbuild e da Lore geral,
 *   organizados em pastas próprias da mesa (renomear/remover vale só aqui)
 * - Sons: mixer de trilhas e ambientação (tocam direto na lista)
 * - Ações: automações agrupadas por dono (gerais do mestre, cada personagem, cada NPC)
 * Fichas, lore e automações abrem numa janela flutuante.
 */
@Component({
  selector: 'app-side-panel',
  imports: [NgTemplateOutlet, MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule, AutoFocus, SoundList, ChatPanel],
  templateUrl: './side-panel.html',
  host: { class: 'flex h-full flex-col' },
})
export class SidePanel {
  readonly session = inject(TableSessionService);
  private readonly worldbuild = inject(WorldbuildService);
  private readonly loreGeneral = inject(LoreService);
  private readonly blobs = inject(BlobUrlService);

  readonly worldMeta = WORLD_ITEM_META;
  /** Ids das janelas dos exploradores (worldbuild e Lore geral) na mesa. */
  readonly worldbuildWindow = WORLDBUILD_WINDOW;
  readonly loreWindow = LORE_WINDOW;

  /** Pedido para abrir um arquivo (da mesa ou do worldbuild) numa janela. */
  readonly opened = output<string>();
  /** Arquivo excluído (para fechar a janela). */
  readonly removed = output<string>();

  // --- Abas ----------------------------------------------------------------
  readonly tabs: { id: PanelTab; icon: string; label: string }[] = [
    { id: 'chat', icon: 'forum', label: 'Chat' },
    { id: 'sheets', icon: 'group', label: 'Fichas' },
    { id: 'lore', icon: 'menu_book', label: 'Lore' },
    { id: 'sounds', icon: 'graphic_eq', label: 'Sons' },
    { id: 'automations', icon: 'bolt', label: 'Ações' },
  ];
  readonly tab = signal<PanelTab>('chat');
  readonly renamingId = signal<string | null>(null);
  readonly query = signal('');

  /** Quantas mensagens do chat já foram vistas (para o aviso de novidade na aba). */
  private readonly seenChat = signal(0);
  /** Há mensagens novas enquanto outra aba está aberta. */
  readonly chatUnread = computed(() => this.tab() !== 'chat' && this.session.chat().length > this.seenChat());

  constructor() {
    // Com a aba Chat aberta, tudo o que chega já conta como visto
    effect(() => {
      const count = this.session.chat().length;
      if (this.tab() === 'chat') this.seenChat.set(count);
    });
  }

  // --- Listas --------------------------------------------------------------
  readonly characters = computed(() => this.byKind('character'));
  /** NPCs visíveis: o jogador só vê os que controla ou cuja ficha/inventário o mestre liberou. */
  readonly npcs = computed(() => this.byKind('npc').filter((e) => this.session.canOpen(e)));

  // --- Lore da mesa --------------------------------------------------------

  /** Itens (exceto pastas) da Lore geral e do worldbuild que não foram removidos desta mesa. */
  private readonly loreRows = computed<LoreRow[]>(() => {
    const overrides = this.session.lore().items;
    const rows = (items: WorldItem[], global: boolean) =>
      items
        .filter((i) => i.type !== 'folder' && !overrides[i.id]?.hidden)
        .map((item) => ({ item, name: overrides[item.id]?.name ?? item.name, global }));
    return [...rows(this.loreGeneral.items(), true), ...rows(this.worldbuild.items(), false)].sort((a, b) =>
      a.name.localeCompare(b.name, 'pt-BR', { numeric: true }),
    );
  });

  /** Pastas da mesa, em ordem alfabética. */
  readonly loreFolders = computed(() =>
    [...this.session.lore().folders].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true })),
  );

  /** Itens agrupados por pasta da mesa (null = raiz; pasta inexistente também cai na raiz). */
  private readonly loreByFolder = computed(() => {
    const folderIds = new Set(this.session.lore().folders.map((f) => f.id));
    const overrides = this.session.lore().items;
    const groups = new Map<string | null, LoreRow[]>();
    for (const row of this.loreRows()) {
      const folderId = overrides[row.item.id]?.folderId;
      const key = folderId && folderIds.has(folderId) ? folderId : null;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    return groups;
  });

  /** Resultado da busca (lista plana) quando há texto digitado. */
  readonly loreSearch = computed(() => {
    const q = this.query().trim().toLowerCase();
    return q ? this.loreRows().filter((r) => r.name.toLowerCase().includes(q)) : null;
  });

  /** Quantos itens foram removidos desta mesa (podem ser restaurados). */
  readonly hiddenLoreCount = computed(() => Object.values(this.session.lore().items).filter((o) => o.hidden).length);

  /** Pastas da mesa abertas na lista (só nesta sessão). */
  readonly expandedFolders = signal(new Set<string>());
  /** Pasta sob o item arrastado (null = raiz; undefined = nenhuma). */
  readonly loreDropTarget = signal<string | null | undefined>(undefined);
  private draggedLoreId: string | null = null;

  // --- Ações ---------------------------------------------------------------

  /** Cria um arquivo; ações recebem o dono (`owner` = id do personagem/NPC; vazio = geral do mestre). */
  create(kind: TableEntryKind, owner?: string): void {
    const entry = this.session.addEntry(kind, owner ? { ownerEntryId: owner } : {});
    this.renamingId.set(entry.id);
    this.opened.emit(entry.id);
  }

  finishRename(entry: TableEntry, value: string): void {
    if (this.renamingId() !== entry.id) return;
    // Fichas renomeiam pelo store (NPC-referência renomeia a ficha base no bestiário)
    if (hasSheet(entry.kind)) this.session.renameSheet(entry.id, value);
    else if (value.trim()) this.session.updateEntry(entry.id, { name: value.trim() });
    this.renamingId.set(null);
  }

  // --- NPCs do bestiário ---------------------------------------------------

  /** Põe na mesa uma referência ao NPC do bestiário e abre a ficha. */
  addNpc(item: WorldItem, global: boolean): void {
    this.opened.emit(this.session.addNpcReference(item, global).id);
  }

  /** Cria um NPC no Worldbuild, põe na mesa e já abre a ficha para preencher. */
  createNpc(): void {
    const entry = this.session.createWorldNpc();
    this.renamingId.set(entry.id);
    this.opened.emit(entry.id);
  }

  /** Personagens/NPCs podem ser arrastados até o mapa para colocar o token (NPC: só quem pode editá-lo). */
  onDragStart(event: DragEvent, entry: TableEntry): void {
    if (entry.kind === 'npc' && !this.session.canEdit(entry)) {
      event.preventDefault();
      return;
    }
    if (!event.dataTransfer || (entry.kind !== 'character' && entry.kind !== 'npc')) return;
    event.dataTransfer.setData(TOKEN_DRAG_TYPE, entry.id);
    event.dataTransfer.effectAllowed = 'copy';
  }

  /** Imagem do token da ficha (para o avatar da lista). */
  tokenImage(entry: TableEntry): string | null {
    return this.blobs.url(entry.token?.blobId);
  }

  remove(entry: TableEntry): void {
    const question = entry.worldNpcId
      ? `Tirar "${entry.name}" da mesa? A ficha base continua no bestiário (Worldbuild).`
      : `Excluir "${entry.name}"?`;
    if (!confirm(question)) return;
    this.session.removeEntry(entry.id);
    this.removed.emit(entry.id);
  }

  // --- Ações da Lore (valem só nesta mesa) -------------------------------

  /** Itens de uma pasta da mesa (null = raiz). */
  loreIn(folderId: string | null): LoreRow[] {
    return this.loreByFolder().get(folderId) ?? [];
  }

  createLoreFolder(): void {
    const folder = this.session.addLoreFolder();
    this.renamingId.set(folder.id);
  }

  toggleFolder(id: string): void {
    this.setFolderOpen(id, !this.expandedFolders().has(id));
  }

  finishFolderRename(folder: LoreFolder, value: string): void {
    if (this.renamingId() !== folder.id) return;
    this.session.renameLoreFolder(folder.id, value);
    this.renamingId.set(null);
  }

  removeLoreFolder(folder: LoreFolder): void {
    if (!confirm(`Excluir a pasta "${folder.name}"? Os itens dela voltam para a lista principal.`)) return;
    this.session.removeLoreFolder(folder.id);
  }

  finishLoreRename(row: LoreRow, value: string): void {
    if (this.renamingId() !== row.item.id) return;
    this.session.renameLoreItem(row.item, value);
    this.renamingId.set(null);
  }

  /** Remove o item só desta mesa (o original continua no worldbuild / Lore geral). */
  hideLore(row: LoreRow): void {
    if (!confirm(`Remover "${row.name}" desta mesa? O original continua ${row.global ? 'na Lore geral' : 'no Worldbuild'}.`)) return;
    this.session.hideLoreItem(row.item.id);
    this.removed.emit(row.item.id);
  }

  // --- Arrastar itens da Lore para as pastas da mesa ---------------------

  onLoreDragStart(event: DragEvent, row: LoreRow): void {
    this.draggedLoreId = row.item.id;
    event.dataTransfer?.setData('text/plain', row.name);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  onLoreDragEnd(): void {
    this.draggedLoreId = null;
    this.loreDropTarget.set(undefined);
  }

  /** Aceita soltar sobre uma pasta (folderId) ou na lista principal (null). */
  onLoreDragOver(event: DragEvent, folderId: string | null): void {
    if (!this.draggedLoreId) return;
    event.preventDefault();
    event.stopPropagation();
    this.loreDropTarget.set(folderId);
  }

  onLoreDrop(event: DragEvent, folderId: string | null): void {
    if (!this.draggedLoreId) return;
    event.preventDefault();
    event.stopPropagation();
    this.session.moveLoreItem(this.draggedLoreId, folderId);
    if (folderId) this.setFolderOpen(folderId, true);
    this.onLoreDragEnd();
  }

  private setFolderOpen(id: string, open: boolean): void {
    this.expandedFolders.update((set) => {
      const next = new Set(set);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /** Ícone/cor de um tipo de arquivo (tipado para os templates). */
  metaOf(kind: TableEntryKind) {
    return TABLE_ENTRY_META[kind];
  }

  loreMeta(item: WorldItem) {
    return WORLD_ITEM_META[item.type];
  }

  private byKind(kind: TableEntryKind): TableEntry[] {
    return this.session.entries().filter((e) => e.kind === kind);
  }
}
