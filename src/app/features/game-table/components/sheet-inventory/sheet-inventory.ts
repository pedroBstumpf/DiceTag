import { Component, computed, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Tag } from '../../../../core/models/tag.model';
import { InventoryEntry } from '../../../../core/models/table-session.model';
import { WorldItem } from '../../../../core/models/world-item.model';
import { newId } from '../../../../core/utils/id';
import { AutoFocus } from '../../../../shared/directives/auto-focus.directive';
import { ItemCardView } from '../../../worldbuild/components/item-card/item-card-view';
import { LoreService } from '../../../worldbuild/services/lore.service';
import { WorldbuildService } from '../../../worldbuild/services/worldbuild.service';
import { BlobUrlService } from '../../services/blob-url.service';
import { TableSessionService } from '../../services/table-session.service';

/** Linha do inventário: o que o cartão mostra (personalização ou original). */
interface InventoryRow {
  entry: InventoryEntry;
  /** Item original (ausente quando foi excluído do worldbuild / Lore geral). */
  item?: WorldItem;
  name: string;
  tags: Tag[];
  blobId?: string;
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
 * Worldbuild). Editar o cartão aqui personaliza só a cópia deste personagem
 * (InventoryEntry guarda o que mudou); o original e os outros inventários não mudam.
 */
@Component({
  selector: 'app-sheet-inventory',
  imports: [MatIconModule, MatTooltipModule, AutoFocus, ItemCardView],
  templateUrl: './sheet-inventory.html',
  host: { class: 'flex min-h-full flex-col gap-4 @xl:flex-row' },
})
export class SheetInventory {
  private readonly session = inject(TableSessionService);
  private readonly worldbuild = inject(WorldbuildService);
  private readonly loreGeneral = inject(LoreService);
  readonly blobs = inject(BlobUrlService);

  readonly entryId = input.required<string>();
  /** Pedido para abrir a janela de um item (o original, no worldbuild). */
  readonly openItem = output<string>();

  // --- Inventário ----------------------------------------------------------

  private readonly inventory = computed(() => {
    const entry = this.session.entryById().get(this.entryId());
    return entry ? this.session.sheetOf(entry).inventory : [];
  });

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
    this.session.removeInventoryItem(this.entryId(), row.entry.id);
  }

  // --- Cópia do personagem (não altera o original) -------------------------

  rename(row: InventoryRow, name: string): void {
    this.session.updateInventoryItem(this.entryId(), row.entry.id, { name });
  }

  setTags(row: InventoryRow, tags: Tag[]): void {
    this.session.updateInventoryItem(this.entryId(), row.entry.id, { tags });
  }

  setImage(row: InventoryRow, file: File): void {
    this.session.setInventoryImage(this.entryId(), row.entry.id, file);
  }

  reset(row: InventoryRow): void {
    this.session.resetInventoryItem(this.entryId(), row.entry.id);
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
    this.session.updateSheet(this.entryId(), { inventory: [...this.inventory(), entry] });
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
