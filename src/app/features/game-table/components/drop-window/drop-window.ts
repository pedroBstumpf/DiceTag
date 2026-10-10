import { Component, computed, inject, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NPC_TOKEN_SHEET } from '../../../../core/models/table-session.model';
import { ItemCardView } from '../../../worldbuild/components/item-card/item-card-view';
import { WorldbuildService } from '../../../worldbuild/services/worldbuild.service';
import { BlobUrlService } from '../../services/blob-url.service';
import { PickupCandidate, TableSessionService } from '../../services/table-session.service';
import { inventoryRow, itemOrigin } from '../../utils/inventory';
import { itemSources } from '../sheet-inventory/sheet-inventory';

/** Prefixo do id das janelas de item no chão (drop:<id do item largado>). */
export const DROP_WINDOW = 'drop:';

/**
 * Janela de um item largado no mapa (clique no item): o cartão completo, só leitura
 * (com a personalização de quem largou), e quem pode pegá-lo — personagens e tokens de
 * NPC, quem age primeiro e depois os mais próximos. Pegar leva a pilha inteira para o
 * inventário. O mestre também muda a quantidade e tira o item do mapa.
 */
@Component({
  selector: 'app-drop-window',
  imports: [MatIconModule, MatTooltipModule, ItemCardView],
  host: { class: 'block h-full overflow-y-auto p-4' },
  template: `
    @if (drop(); as d) {
      @if (row(); as r) {
        @if (r.missing) {
          <p class="py-10 text-center text-sm text-slate-500">Este item foi excluído {{ origin() }}.</p>
        } @else {
          <fieldset class="mx-auto w-full min-w-0 max-w-sm" disabled>
            <app-item-card-view [name]="r.name" [tags]="r.tags" [imageUrl]="blobs.url(r.blobId)" [description]="r.description" />
          </fieldset>
        }

        <!-- Quantidade da pilha (o mestre ajusta) -->
        <div class="mx-auto mt-3 flex max-w-sm items-center justify-center gap-2 text-xs text-slate-400">
          <mat-icon class="!size-4 !text-[16px] text-amber-300">location_on</mat-icon>
          No chão
          @if (session.canManageDrops()) {
            <label class="ml-2 flex items-center gap-1.5">
              Qtd.
              <input
                #qty
                type="number"
                min="1"
                class="h-7 w-14 rounded-md bg-ink-950 px-1 text-center tabular-nums text-slate-100 outline-none ring-1 ring-white/10 focus:ring-astral-500/60"
                [value]="r.quantity"
                (change)="setQuantity(qty.value)"
              />
            </label>
          } @else if (r.quantity > 1) {
            <span class="tabular-nums text-slate-300">×{{ r.quantity }}</span>
          }
        </div>

        <!-- Pegar: a pilha vai para o inventário de quem pega -->
        <section class="sheet-card mx-auto mt-4 max-w-sm">
          <h3 class="sheet-title">
            <mat-icon class="!size-4 !text-[16px]">back_hand</mat-icon>
            Pegar com
          </h3>
          <div class="flex flex-col gap-0.5">
            @for (c of candidates(); track c.sheetId) {
              <button
                type="button"
                class="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-sm text-slate-300 transition-colors hover:bg-amber-400/10 hover:text-white"
                (click)="pickUp(c)"
              >
                @if (blobs.url(c.blobId); as src) {
                  <img [src]="src" alt="" class="size-6 shrink-0 rounded-full object-cover object-top ring-1 ring-white/30" />
                } @else {
                  <mat-icon class="!size-6 shrink-0 !text-[20px]" [class]="isNpc(c) ? 'text-violet-300' : 'text-astral-300'">
                    {{ isNpc(c) ? 'smart_toy' : 'person' }}
                  </mat-icon>
                }
                <span class="min-w-0 flex-1 truncate">{{ c.name }}</span>
                @if (c.distance !== undefined) {
                  <span class="shrink-0 text-[11px] tabular-nums text-slate-500" matTooltip="Distância até o item">{{ distanceLabel(c) }}</span>
                }
                <mat-icon class="!size-4 shrink-0 !text-[16px] text-amber-300">add_box</mat-icon>
              </button>
            } @empty {
              <p class="px-1 py-2 text-xs leading-relaxed text-slate-500">
                Nenhum personagem ou NPC seu pode pegar este item. Crie um personagem na aba Fichas.
              </p>
            }
          </div>
        </section>

        @if (session.canManageDrops()) {
          <div class="mt-3 flex justify-center">
            <button type="button" class="flex items-center gap-1 rounded-md px-3 py-1.5 text-xs text-slate-400 hover:bg-white/5 hover:text-red-300" (click)="remove()">
              <mat-icon class="!size-4 !text-[16px]">delete</mat-icon>
              Tirar do mapa
            </button>
          </div>
        }
      }
    }
  `,
})
export class DropWindow {
  readonly session = inject(TableSessionService);
  private readonly worldbuild = inject(WorldbuildService);
  private readonly snackBar = inject(MatSnackBar);
  readonly blobs = inject(BlobUrlService);

  /** Id do item largado. */
  readonly dropId = input.required<string>();
  /** O item saiu do mapa (pego ou removido): fechar a janela. */
  readonly closed = output<void>();

  readonly drop = computed(() => this.session.dropById(this.dropId())?.drop ?? null);
  /** O item como o cartão o mostra (personalização de quem largou ou o original). */
  readonly row = computed(() => {
    const drop = this.drop();
    return drop ? inventoryRow(drop.item, itemSources(this.worldbuild, this.session)) : null;
  });
  readonly origin = computed(() => {
    const drop = this.drop();
    return drop ? itemOrigin(drop.item) : '';
  });
  readonly candidates = computed(() => {
    const drop = this.drop();
    return drop ? this.session.pickupCandidates(drop) : [];
  });

  /** Token de NPC (ficha "npc:<id do token>") ou personagem. */
  isNpc(c: PickupCandidate): boolean {
    return c.sheetId.startsWith(NPC_TOKEN_SHEET);
  }

  distanceLabel(c: PickupCandidate): string {
    return `${(c.distance ?? 0).toFixed(1)} quad.`;
  }

  pickUp(c: PickupCandidate): void {
    const name = this.session.pickUpDrop(this.dropId(), c.sheetId);
    if (!name) return;
    this.snackBar.open(`${c.name} pegou ${name}.`, undefined, { duration: 3000 });
    this.closed.emit();
  }

  /** Quantidade digitada (inteiro ≥ 1; texto inválido é ignorado). */
  setQuantity(raw: string): void {
    const n = Number(raw);
    if (raw.trim() !== '' && Number.isFinite(n)) this.session.setDropQuantity(this.dropId(), n);
  }

  remove(): void {
    this.session.removeDrop(this.dropId());
    this.closed.emit();
  }
}
