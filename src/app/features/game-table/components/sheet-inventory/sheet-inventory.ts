import { Component, computed, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Tag } from '../../../../core/models/tag.model';
import { CURRENCY, ITEM_DRAG_TYPE, InventoryEntry, ItemDragData, TableEntry } from '../../../../core/models/table-session.model';
import { newId } from '../../../../core/utils/id';
import { AutoFocus } from '../../../../shared/directives/auto-focus.directive';
import { ItemCardView } from '../../../worldbuild/components/item-card/item-card-view';
import { WorldbuildService } from '../../../worldbuild/services/worldbuild.service';
import { BlobUrlService } from '../../services/blob-url.service';
import { SheetStore } from '../../../../core/services/sheet-store';
import { TableSessionService } from '../../services/table-session.service';
import { CardItem, InventoryRow, ItemSource, ItemSources, inventoryRow, itemOrigin } from '../../utils/inventory';

const NO_ITEMS = new Map<string, CardItem>();

/** Fontes dos itens (lê signals: use dentro de computed). Fora da mesa não há itens da mesa. */
export function itemSources(worldbuild: WorldbuildService, session: TableSessionService | null): ItemSources {
  return { own: worldbuild.byId(), table: session?.tableItemById() ?? NO_ITEMS };
}

/** Item (do mundo ou da mesa) que pode ser adicionado ao inventário. */
interface ItemOption {
  item: CardItem;
  source: ItemSource;
}

/**
 * Aba Inventário da ficha: lista dos itens do personagem e, ao lado, o cartão
 * do item selecionado (imagem, nome e etiquetas).
 *
 * Os itens vêm do mundo (aba "Itens" do Worldbuild; o jogador só vê os revelados na aba Lore)
 * ou são itens da mesa: o jogador que cria um item no inventário o
 * cria só nesta mesa (TableState.items), nunca no Worldbuild. Editar o cartão aqui personaliza só a cópia desta ficha
 * (InventoryEntry guarda o que mudou); o original e os outros inventários não mudam.
 * `readonly`: jogador vendo o inventário público de um NPC (só seleciona e vê os cartões).
 *
 * Loja: no inventário de NPC há uma coluna de preço em Eiros (editável por quem edita
 * o NPC); o jogador que vê o inventário compra um item com os Eiros do personagem dele
 * (ou o pega de graça, se o NPC estiver derrotado).
 * "Dar para…": personagens passam itens uns aos outros, com a personalização.
 * A caixa à esquerda de cada item marca se ele está equipado (personagens e NPCs).
 */
@Component({
  selector: 'app-sheet-inventory',
  imports: [MatIconModule, MatMenuModule, MatTooltipModule, AutoFocus, ItemCardView],
  templateUrl: './sheet-inventory.html',
  host: { class: 'flex min-h-full flex-col gap-4 @xl:flex-row' },
})
export class SheetInventory {
  private readonly store = inject(SheetStore);
  /** Presente só na mesa (loja, loot e "Dar para"). */
  private readonly session = inject(TableSessionService, { optional: true });
  private readonly worldbuild = inject(WorldbuildService);
  private readonly snackBar = inject(MatSnackBar);
  readonly blobs = inject(BlobUrlService);

  /** Id da ficha no SheetStore. */
  readonly sheetId = input.required<string>();
  /** Só ver (jogador olhando o inventário público de um NPC): sem adicionar, tirar nem editar. */
  readonly readonly = input(false);
  /** Pedido para abrir a janela de um item (o original, no worldbuild). */
  readonly openItem = output<string>();

  // --- Inventário ----------------------------------------------------------

  private readonly data = computed(() => this.store.sheetData(this.sheetId()));
  private readonly inventory = computed(() => this.data()?.sheet.inventory ?? []);

  readonly rows = computed<InventoryRow[]>(() => {
    const sources = itemSources(this.worldbuild, this.session);
    return this.inventory().map((entry) => inventoryRow(entry, sources));
  });

  /** Texto do item excluído (de onde ele sumiu). */
  origin(row: InventoryRow): string {
    return itemOrigin(row.entry);
  }

  /** Linha selecionada (padrão: a primeira). */
  private readonly selectedId = signal<string | null>(null);
  readonly selected = computed(() => {
    const rows = this.rows();
    return rows.find((r) => r.entry.id === this.selectedId()) ?? rows[0] ?? null;
  });

  isSelected(row: InventoryRow): boolean {
    return this.selected()?.entry.id === row.entry.id;
  }

  select(row: InventoryRow): void {
    this.selectedId.set(row.entry.id);
  }

  remove(row: InventoryRow): void {
    this.store.removeInventoryItem(this.sheetId(), row.entry.id);
  }

  // --- Cópia do personagem (não altera o original) -------------------------

  // (exceto o item da mesa criado por quem edita: aí muda o próprio item, que aparece na aba Lore)

  rename(row: InventoryRow, name: string): void {
    if (this.editsTableItem(row)) this.session?.updateTableItem(row.entry.itemId, { name });
    else this.store.updateInventoryItem(this.sheetId(), row.entry.id, { name });
  }

  describe(row: InventoryRow, description: string): void {
    if (this.editsTableItem(row)) this.session?.updateTableItem(row.entry.itemId, { description });
    else this.store.updateInventoryItem(this.sheetId(), row.entry.id, { description });
  }

  setTags(row: InventoryRow, tags: Tag[]): void {
    if (this.editsTableItem(row)) this.session?.updateTableItem(row.entry.itemId, { tags });
    else this.store.updateInventoryItem(this.sheetId(), row.entry.id, { tags });
  }

  setImage(row: InventoryRow, file: File): void {
    if (this.editsTableItem(row)) this.session?.setTableItemImage(row.entry.itemId, file);
    else this.store.setInventoryImage(this.sheetId(), row.entry.id, file);
  }

  /** O cartão edita o item da mesa (criado por quem edita, ou mestre) e não uma cópia? */
  editsTableItem(row: InventoryRow): boolean {
    return !!row.entry.table && !row.custom && !!this.session?.canEditTableItem(row.entry.itemId);
  }

  /** Quantidade digitada (inteiro ≥ 0; texto inválido é ignorado). */
  setQuantity(row: InventoryRow, raw: string): void {
    const n = Number(raw);
    if (raw.trim() !== '' && Number.isFinite(n)) {
      this.store.updateInventoryItem(this.sheetId(), row.entry.id, { quantity: Math.max(0, Math.round(n)) });
    }
  }

  reset(row: InventoryRow): void {
    this.store.resetInventoryItem(this.sheetId(), row.entry.id);
  }

  // --- Largar no mapa ------------------------------------------------------

  /**
   * Itens podem ser arrastados até o mapa (larga uma unidade no chão): só na mesa, por quem
   * edita a ficha, em fichas que moram na mesa (a ficha base do bestiário é o "molde" das cópias).
   */
  readonly canDrop = computed(() => !this.readonly() && this.tableItemsAllowed());

  onDragStart(event: DragEvent, row: InventoryRow): void {
    if (!this.canDrop() || row.missing || row.quantity < 1 || !event.dataTransfer) {
      event.preventDefault();
      return;
    }
    const data: ItemDragData = { source: 'inventory', sheetId: this.sheetId(), inventoryId: row.entry.id };
    event.dataTransfer.setData(ITEM_DRAG_TYPE, JSON.stringify(data));
    event.dataTransfer.effectAllowed = 'move';
  }

  // --- Equipados (personagens e NPCs) --------------------------------------

  /** Toda ficha (personagem ou NPC) tem a caixa "equipado" em cada item (listados na aba Ficha). */
  readonly canEquip = computed(() => !!this.data());

  setEquipped(row: InventoryRow, equipped: boolean): void {
    this.store.updateInventoryItem(this.sheetId(), row.entry.id, { equipped: equipped || undefined });
  }

  // --- Loja (inventário de NPC com preços em Eiros) ------------------------

  readonly currency = CURRENCY;
  /** Inventário de NPC: tem a coluna de preço e pode virar loja para os jogadores. */
  readonly isShop = computed(() => this.data()?.kind === 'npc');
  /**
   * Inventário que vende e pode ser looteado: NPC da mesa com dados próprios ou token de NPC.
   * A ficha base do bestiário (`npc-base` / `world`) não: comprar mexeria no original.
   */
  readonly trades = computed(() => {
    const level = this.data()?.level;
    return !!this.session && (level === 'npc' || level === 'npc-token');
  });
  /** Ficha base de NPC vista na mesa: a loja e o loot acontecem nos tokens dele. */
  readonly tradesInTokens = computed(() => !!this.session && this.isShop() && !this.trades());
  /** Personagem do jogador que compra (só na mesa, no papel de jogador, em loja de NPC). */
  readonly buyer = computed(() => {
    const buyer = this.session?.buyer();
    return this.trades() && this.session?.role() === 'player' && buyer ? buyer : null;
  });
  /** Eiros do comprador. */
  readonly buyerEiros = computed(() => {
    const buyer = this.buyer();
    return buyer && this.session ? this.session.sheetOf(buyer).eiros : 0;
  });

  /** Preço digitado (vazio = não está à venda). */
  setPrice(row: InventoryRow, raw: string): void {
    const n = Number(raw);
    if (raw.trim() === '') this.store.updateInventoryItem(this.sheetId(), row.entry.id, { price: undefined });
    else if (Number.isFinite(n) && n >= 0) this.store.updateInventoryItem(this.sheetId(), row.entry.id, { price: Math.round(n) });
  }

  // --- Dar itens a outros personagens --------------------------------------

  /** Personagens da mesa que podem receber itens desta ficha (menos ela mesma). */
  readonly recipients = computed(() =>
    this.data()?.level !== 'character' || !this.session
      ? []
      : this.session.entries().filter((e) => e.kind === 'character' && e.id !== this.sheetId()),
  );

  /** Dá uma unidade do item (com nome, etiquetas e imagem personalizados) a outro personagem. */
  async give(row: InventoryRow, target: TableEntry): Promise<void> {
    const ok = await this.session?.transferItem(this.sheetId(), row.entry.id, target.id);
    if (ok) this.snackBar.open(`${row.name} foi para o inventário de ${target.name}.`, undefined, { duration: 3000 });
  }

  /** NPC derrotado (alguma barra de status em 0): os itens podem ser looteados sem pagar. */
  readonly defeated = computed(() => this.trades() && !!this.session?.isDefeated(this.sheetId()));

  async loot(row: InventoryRow): Promise<void> {
    const buyer = this.buyer();
    if (!buyer) return;
    const ok = await this.session?.lootItem(this.sheetId(), row.entry.id, buyer.id);
    if (ok) this.snackBar.open(`${buyer.name} pegou ${row.name}.`, undefined, { duration: 3000 });
  }

  /** À venda, com estoque e Eiros suficientes. */
  canAfford(row: InventoryRow): boolean {
    return row.entry.price !== undefined && row.quantity > 0 && this.buyerEiros() >= row.entry.price;
  }

  async buy(row: InventoryRow): Promise<void> {
    const buyer = this.buyer();
    if (!buyer || !this.session || row.entry.price === undefined) return;
    const ok = await this.session.buyItem(this.sheetId(), row.entry.id, buyer.id);
    this.snackBar.open(
      ok ? `${buyer.name} comprou ${row.name} por ${row.entry.price} ${CURRENCY}.` : `${buyer.name} não tem ${CURRENCY} suficientes.`,
      undefined,
      { duration: 3000 },
    );
  }

  // --- Adicionar itens -----------------------------------------------------

  /** Painel de escolha de itens aberto. */
  readonly picking = signal(false);
  readonly query = signal('');

  /** Na mesa, no papel de jogador (o Worldbuild é só do mestre). */
  readonly isPlayer = computed(() => this.session?.role() === 'player');
  /**
   * A ficha pode ter itens da mesa: fichas que moram na mesa. A ficha base do bestiário
   * (`npc-base` / `world`) não, porque fica no Worldbuild, fora desta mesa.
   */
  readonly tableItemsAllowed = computed(() => {
    const level = this.data()?.level;
    return !!this.session && level !== 'npc-base' && level !== 'world';
  });
  /** "Criar item": o jogador cria só nesta mesa; o mestre, no Worldbuild. */
  readonly createsInTable = computed(() => this.isPlayer() && this.tableItemsAllowed());
  readonly canCreate = computed(() => !this.isPlayer() || this.tableItemsAllowed());

  /** Itens que podem entrar no inventário (do mundo e da mesa), filtrados pela busca. */
  readonly options = computed<ItemOption[]>(() => {
    const q = this.query().trim().toLowerCase();
    // O jogador só vê os itens do mundo que o mestre revelou na aba Lore
    const own = this.worldbuild.worldItems().filter((item) => !this.isPlayer() || !!this.session?.canSeeLoreItem(item.id));
    const options: ItemOption[] = own.map((item) => ({ item, source: 'own' }));
    if (this.tableItemsAllowed() && this.session) {
      options.push(...this.session.tableItems().map((item) => ({ item, source: 'table' as const })));
    }
    return options.filter((o) => !q || o.item.name.toLowerCase().includes(q));
  });

  add(option: ItemOption): void {
    const entry: InventoryEntry = {
      id: newId(),
      itemId: option.item.id,
      ...(option.source === 'table' && { table: true }),
    };
    this.store.updateSheet(this.sheetId(), { inventory: [...this.inventory(), entry] });
    this.selectedId.set(entry.id);
    this.closePicker();
  }

  /**
   * Cria um item novo e o adiciona. Jogador: item só desta mesa (o cartão ao lado já fica
   * editável). Mestre: item no worldbuild do usuário, com o cartão original aberto para editar.
   */
  createItem(): void {
    const name = this.query().trim();
    if (this.createsInTable() && this.session) {
      this.add({ item: this.session.createTableItem(name), source: 'table' });
      return;
    }
    const item = this.worldbuild.create('item', null, name || undefined);
    this.add({ item, source: 'own' });
    this.openItem.emit(item.id);
  }

  closePicker(): void {
    this.picking.set(false);
    this.query.set('');
  }
}
