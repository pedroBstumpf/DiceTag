import { Component, computed, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Tag } from '../../../../core/models/tag.model';
import { CURRENCY, InventoryEntry, TableEntry } from '../../../../core/models/table-session.model';
import { WorldItem } from '../../../../core/models/world-item.model';
import { newId } from '../../../../core/utils/id';
import { AutoFocus } from '../../../../shared/directives/auto-focus.directive';
import { ItemCardView } from '../../../worldbuild/components/item-card/item-card-view';
import { LoreService } from '../../../worldbuild/services/lore.service';
import { WorldbuildService } from '../../../worldbuild/services/worldbuild.service';
import { BlobUrlService } from '../../services/blob-url.service';
import { SheetStore } from '../../services/sheet-store';
import { TableSessionService } from '../../services/table-session.service';
import { quantityOf } from '../../utils/inventory';

/** Linha do inventário: o que o cartão mostra (personalização ou original). */
interface InventoryRow {
  entry: InventoryEntry;
  /** Item original (ausente quando foi excluído do worldbuild / Lore geral). */
  item?: WorldItem;
  name: string;
  tags: Tag[];
  blobId?: string;
  /** Unidades (na loja, 0 = esgotado). */
  quantity: number;
  /** Tem nome, etiquetas ou imagem próprios deste personagem. */
  custom: boolean;
  /** Original excluído e nada personalizado: não há o que mostrar. */
  missing: boolean;
}

/** Item do mundo que pode ser adicionado ao inventário. */
interface ItemOption {
  item: WorldItem;
  global: boolean;
}

/**
 * Aba Inventário da ficha: lista dos itens do personagem e, ao lado, o cartão
 * do item selecionado (imagem, nome e etiquetas).
 *
 * Os itens vêm do worldbuild do usuário ou da Lore geral (aba "Itens" do
 * Worldbuild). Editar o cartão aqui personaliza só a cópia desta ficha
 * (InventoryEntry guarda o que mudou); o original e os outros inventários não mudam.
 * `readonly`: jogador vendo o inventário público de um NPC (só seleciona e vê os cartões).
 *
 * Loja: no inventário de NPC há uma coluna de preço em Eiros (editável por quem edita
 * o NPC); o jogador que vê o inventário compra um item com os Eiros do personagem dele
 * (ou o pega de graça, se o NPC estiver derrotado).
 * "Dar para…": personagens passam itens uns aos outros, com a personalização.
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
  private readonly loreGeneral = inject(LoreService);
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
    const global = this.loreGeneral.byId();
    const own = this.worldbuild.byId();
    return this.inventory().map((entry) => {
      const item = (entry.global ? global : own).get(entry.itemId);
      const custom = entry.name !== undefined || entry.tags !== undefined || entry.blobId !== undefined;
      return {
        entry,
        item,
        name: entry.name ?? item?.name ?? 'Item excluído',
        tags: entry.tags ?? item?.tags ?? [],
        blobId: entry.blobId ?? item?.blobId,
        quantity: quantityOf(entry),
        custom,
        missing: !item && !custom,
      };
    });
  });

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

  rename(row: InventoryRow, name: string): void {
    this.store.updateInventoryItem(this.sheetId(), row.entry.id, { name });
  }

  setTags(row: InventoryRow, tags: Tag[]): void {
    this.store.updateInventoryItem(this.sheetId(), row.entry.id, { tags });
  }

  setImage(row: InventoryRow, file: File): void {
    this.store.setInventoryImage(this.sheetId(), row.entry.id, file);
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

  // --- Loja (inventário de NPC com preços em Eiros) ------------------------

  readonly currency = CURRENCY;
  /** Inventário de NPC: tem a coluna de preço e pode virar loja para os jogadores. */
  readonly isShop = computed(() => this.data()?.kind === 'npc');
  /** Personagem do jogador que compra (só na mesa, no papel de jogador, em loja de NPC). */
  readonly buyer = computed(() => {
    const buyer = this.session?.buyer();
    return this.isShop() && this.session?.role() === 'player' && buyer ? buyer : null;
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
    this.isShop() || !this.session ? [] : this.session.entries().filter((e) => e.kind === 'character' && e.id !== this.sheetId()),
  );

  /** Dá uma unidade do item (com nome, etiquetas e imagem personalizados) a outro personagem. */
  async give(row: InventoryRow, target: TableEntry): Promise<void> {
    const ok = await this.session?.transferItem(this.sheetId(), row.entry.id, target.id);
    if (ok) this.snackBar.open(`${row.name} foi para o inventário de ${target.name}.`, undefined, { duration: 3000 });
  }

  /** NPC derrotado (alguma barra de status em 0): os itens podem ser looteados sem pagar. */
  readonly defeated = computed(() => !!this.session?.isDefeated(this.sheetId()));

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

  /** Itens do mundo (Lore geral + worldbuild) filtrados pela busca. */
  readonly options = computed<ItemOption[]>(() => {
    const q = this.query().trim().toLowerCase();
    return [
      ...this.loreGeneral.worldItems().map((item) => ({ item, global: true })),
      ...this.worldbuild.worldItems().map((item) => ({ item, global: false })),
    ].filter((o) => !q || o.item.name.toLowerCase().includes(q));
  });

  add(option: ItemOption): void {
    const entry: InventoryEntry = { id: newId(), itemId: option.item.id, ...(option.global && { global: true }) };
    this.store.updateSheet(this.sheetId(), { inventory: [...this.inventory(), entry] });
    this.selectedId.set(entry.id);
    this.closePicker();
  }

  /** Cria um item novo no worldbuild do usuário, adiciona e abre o cartão original para editar. */
  createItem(): void {
    const item = this.worldbuild.create('item', null, this.query().trim() || undefined);
    this.add({ item, global: false });
    this.openItem.emit(item.id);
  }

  closePicker(): void {
    this.picking.set(false);
    this.query.set('');
  }
}
