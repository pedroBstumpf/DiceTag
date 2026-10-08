import { Component, computed, inject, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Tag } from '../../../../core/models/tag.model';
import { ItemCardView } from '../../../worldbuild/components/item-card/item-card-view';
import { BlobUrlService } from '../../services/blob-url.service';
import { TableSessionService } from '../../services/table-session.service';

/**
 * Janela de um item criado na mesa por um jogador (aberto pela aba Lore): o cartão
 * do item (imagem, nome e etiquetas). Quem criou e o mestre editam; os demais só veem.
 */
@Component({
  selector: 'app-table-item-window',
  imports: [MatIconModule, ItemCardView],
  host: { class: 'block h-full overflow-y-auto p-4' },
  template: `
    @if (item(); as it) {
      <fieldset class="mx-auto w-full min-w-0 max-w-sm" [disabled]="!canEdit()">
        <app-item-card-view
          [name]="it.name"
          [tags]="it.tags ?? []"
          [imageUrl]="blobs.url(it.blobId)"
          (renamed)="update({ name: $event })"
          (tagsChange)="update({ tags: $event })"
          (imagePicked)="session.setTableItemImage(it.id, $event)"
        />
      </fieldset>
      <p class="mx-auto mt-3 flex max-w-sm items-center justify-center gap-1.5 text-center text-[11px] leading-relaxed text-slate-500">
        <mat-icon class="!size-4 shrink-0 !text-[16px] text-emerald-300/70">table_restaurant</mat-icon>
        Item criado nesta mesa por um jogador{{ canEdit() ? '' : ' (só quem o criou e o mestre editam)' }}.
      </p>
    }
  `,
})
export class TableItemWindow {
  readonly session = inject(TableSessionService);
  readonly blobs = inject(BlobUrlService);

  readonly itemId = input.required<string>();

  readonly item = computed(() => this.session.tableItemById().get(this.itemId()) ?? null);
  readonly canEdit = computed(() => this.session.canEditTableItem(this.itemId()));

  update(patch: { name?: string; tags?: Tag[] }): void {
    this.session.updateTableItem(this.itemId(), patch);
  }
}
