import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { WorldItem } from '../../../../core/models/world-item.model';
import { ITEM_DRAG_TYPE, ItemDragData, TABLE_ENTRY_META, TableEntry, TableEntryKind, hasSheet } from '../../../../core/models/table-session.model';
import { AutoFocus } from '../../../../shared/directives/auto-focus.directive';
import { Explorer } from '../../../worldbuild/components/explorer/explorer';
import { BlobUrlService } from '../../services/blob-url.service';
import { TableSessionService } from '../../services/table-session.service';
import { TOKEN_DRAG_TYPE } from '../map-layers/tokens-layer/tokens-layer';
import { ChatPanel } from '../chat-panel/chat-panel';
import { SoundList } from '../sound-list/sound-list';

/** Abas do painel lateral direito. */
type PanelTab = 'chat' | 'sheets' | 'lore' | 'sounds' | 'automations';

/**
 * Painel lateral direito da mesa, com abas:
 * - Chat: mensagens e resultados das rolagens
 * - Fichas: personagens e NPCs
 * - Lore: a árvore do mundo da mesa (o mesmo explorador do Worldbuild: o que o mestre muda
 *   aqui muda no mundo) com o "olho" que revela pastas aos jogadores nesta mesa, mais os
 *   itens criados na mesa pelos jogadores
 * - Sons: mixer de trilhas e ambientação (tocam direto na lista)
 * - Ações: automações agrupadas por dono (gerais do mestre, cada personagem, cada NPC)
 * Fichas, lore e automações abrem numa janela flutuante.
 */
@Component({
  selector: 'app-side-panel',
  imports: [NgTemplateOutlet, MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule, AutoFocus, SoundList, ChatPanel, Explorer],
  templateUrl: './side-panel.html',
  host: { class: 'flex h-full flex-col' },
})
export class SidePanel {
  readonly session = inject(TableSessionService);
  private readonly blobs = inject(BlobUrlService);

  /** Pedido para abrir um arquivo (da mesa ou do worldbuild) numa janela. */
  readonly opened = output<string>();
  /** Arquivos excluídos (para fechar as janelas). */
  readonly removed = output<string[]>();

  // --- Abas ----------------------------------------------------------------
  private readonly allTabs: { id: PanelTab; icon: string; label: string; gmOnly?: boolean }[] = [
    { id: 'chat', icon: 'forum', label: 'Chat' },
    { id: 'sheets', icon: 'group', label: 'Fichas' },
    { id: 'lore', icon: 'menu_book', label: 'Lore' },
    { id: 'sounds', icon: 'graphic_eq', label: 'Sons', gmOnly: true },
    // O jogador cria e usa as ações dele na aba Habilidades da ficha e na barra de ações
    { id: 'automations', icon: 'bolt', label: 'Ações', gmOnly: true },
  ];
  /** Abas do papel atual (Sons e Ações são só do mestre). */
  readonly tabs = computed(() => this.allTabs.filter((t) => !t.gmOnly || this.session.role() === 'gm'));
  private readonly chosenTab = signal<PanelTab>('chat');
  /** Aba aberta (volta ao Chat se a escolhida não existir no papel atual). */
  readonly tab = computed<PanelTab>(() => (this.tabs().some((t) => t.id === this.chosenTab()) ? this.chosenTab() : 'chat'));

  selectTab(tab: PanelTab): void {
    this.chosenTab.set(tab);
  }
  readonly renamingId = signal<string | null>(null);

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
  /** NPCs visíveis: o jogador só vê os que controla (os demais, só pelos tokens no mapa). */
  readonly npcs = computed(() => this.byKind('npc').filter((e) => this.session.canEdit(e)));

  // --- Lore da mesa --------------------------------------------------------

  /** O mestre edita a lore (o próprio mundo) e revela pastas; o jogador só lê o que foi revelado. */
  readonly isGm = computed(() => this.session.role() === 'gm');

  /** Filtro do explorador: o jogador só vê itens em pastas reveladas nesta mesa. */
  readonly loreFilter = computed(() => (this.isGm() ? null : (id: string) => this.session.canSeeLoreItem(id)));

  /** Itens criados nesta mesa pelos jogadores (registro dos feitos deles; todos veem). */
  readonly tableItems = computed(() =>
    [...this.session.tableItems()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true })),
  );
  /** Lista "Itens da mesa" aberta. */
  readonly tableItemsOpen = signal(true);

  /** Mestre: arrastar um item da mesa até o mapa o larga no chão (itens do mundo vêm do explorador). */
  onTableItemDragStart(event: DragEvent, itemId: string): void {
    if (!event.dataTransfer || !this.isGm()) return;
    const data: ItemDragData = { source: 'table', itemId };
    event.dataTransfer.setData(ITEM_DRAG_TYPE, JSON.stringify(data));
    event.dataTransfer.effectAllowed = 'move';
  }

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
  addNpc(item: WorldItem): void {
    this.opened.emit(this.session.addNpcReference(item).id);
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
    this.removed.emit([entry.id]);
  }

  /** Ícone/cor de um tipo de arquivo (tipado para os templates). */
  metaOf(kind: TableEntryKind) {
    return TABLE_ENTRY_META[kind];
  }

  private byKind(kind: TableEntryKind): TableEntry[] {
    return this.session.entries().filter((e) => e.kind === kind);
  }
}
