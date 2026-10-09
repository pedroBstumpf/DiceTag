import { Component, computed, inject, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Tag } from '../../../../core/models/tag.model';
import { SheetStore } from '../../../../core/services/sheet-store';
import { ItemCardView } from '../../../worldbuild/components/item-card/item-card-view';
import { LoreService } from '../../../worldbuild/services/lore.service';
import { WorldbuildService } from '../../../worldbuild/services/worldbuild.service';
import { BlobUrlService } from '../../services/blob-url.service';
import { TableSessionService } from '../../services/table-session.service';
import { inventoryRow, itemOrigin } from '../../utils/inventory';
import { itemSources } from '../sheet-inventory/sheet-inventory';

/** Prefixo do id das janelas de item equipado (equip:<id da ficha>:<id do item no inventário>). */
export const EQUIPPED_WINDOW = 'equip:';

/** Id da janela que mostra um item do inventário de uma ficha. */
export function equippedWindowId(sheetId: string, inventoryId: string): string {
  return `${EQUIPPED_WINDOW}${sheetId}:${inventoryId}`;
}

/** Ficha e item a partir do id da janela (null se não for janela de item equipado). */
export function parseEquippedWindow(id: string): { sheetId: string; inventoryId: string } | null {
  if (!id.startsWith(EQUIPPED_WINDOW)) return null;
  // O id do item não tem ":" (o da ficha pode ter: "npc:<token>")
  const rest = id.slice(EQUIPPED_WINDOW.length);
  const cut = rest.lastIndexOf(':');
  return cut > 0 ? { sheetId: rest.slice(0, cut), inventoryId: rest.slice(cut + 1) } : null;
}

/**
 * Janela de um item equipado (aberto pela lista "Equipados" da aba Ficha): o mesmo
 * cartão do inventário (imagem, nome e etiquetas, com a personalização da ficha).
 * Quem edita a ficha também edita o cartão aqui; os demais só veem.
 */
@Component({
  selector: 'app-equipped-item-window',
  imports: [MatIconModule, ItemCardView],
  host: { class: 'block h-full overflow-y-auto p-4' },
  template: `
    @if (row(); as r) {
      @if (r.missing) {
        <p class="py-10 text-center text-sm text-slate-500">Este item foi excluído {{ origin() }}.</p>
      } @else {
        <fieldset class="mx-auto w-full min-w-0 max-w-sm" [disabled]="!canEdit()">
          <app-item-card-view
            [name]="r.name"
            [tags]="r.tags"
            [imageUrl]="blobs.url(r.blobId)"
            [description]="r.description"
            (renamed)="update({ name: $event })"
            (descriptionChange)="update({ description: $event })"
            (tagsChange)="update({ tags: $event })"
            (imagePicked)="setImage($event)"
          />
        </fieldset>
        <p class="mt-3 flex items-center justify-center gap-1.5 text-xs text-slate-400">
          <mat-icon class="!size-4 !text-[16px] text-astral-300">{{ r.entry.equipped ? 'shield' : 'backpack' }}</mat-icon>
          {{ r.entry.equipped ? 'Equipado' : 'No inventário' }}{{ ownerName() ? ' — ' + ownerName() : '' }}
          @if (r.quantity !== 1) {
            <span class="tabular-nums text-slate-500">(×{{ r.quantity }})</span>
          }
        </p>
      }
    }
  `,
})
export class EquippedItemWindow {
  private readonly store = inject(SheetStore);
  private readonly session = inject(TableSessionService);
  private readonly worldbuild = inject(WorldbuildService);
  private readonly loreGeneral = inject(LoreService);
  readonly blobs = inject(BlobUrlService);

  readonly sheetId = input.required<string>();
  readonly inventoryId = input.required<string>();

  /** O item como o inventário da ficha o mostra (personalização ou original). */
  readonly row = computed(() => {
    const entry = this.store.inventoryOf(this.sheetId()).find((i) => i.id === this.inventoryId());
    return entry ? inventoryRow(entry, itemSources(this.loreGeneral, this.worldbuild, this.session)) : null;
  });
  /** Texto do item excluído (de onde ele sumiu). */
  readonly origin = computed(() => {
    const row = this.row();
    return row ? itemOrigin(row.entry) : '';
  });
  readonly ownerName = computed(() => this.store.sheetData(this.sheetId())?.name ?? '');
  readonly canEdit = computed(() => this.session.sheetAccess(this.sheetId()).edit);

  // --- Cópia da ficha (não altera o original) ------------------------------
  // (exceto o item da mesa criado por quem edita: aí muda o próprio item, como no inventário)

  /** Id do item da mesa editado diretamente (null = edita a cópia da ficha). */
  private readonly tableItemId = computed(() => {
    const row = this.row();
    return row?.entry.table && !row.custom && this.session.canEditTableItem(row.entry.itemId) ? row.entry.itemId : null;
  });

  update(patch: { name?: string; tags?: Tag[]; description?: string }): void {
    const itemId = this.tableItemId();
    if (itemId) this.session.updateTableItem(itemId, patch);
    else this.store.updateInventoryItem(this.sheetId(), this.inventoryId(), patch);
  }

  setImage(file: File): void {
    const itemId = this.tableItemId();
    if (itemId) this.session.setTableItemImage(itemId, file);
    else this.store.setInventoryImage(this.sheetId(), this.inventoryId(), file);
  }
}
