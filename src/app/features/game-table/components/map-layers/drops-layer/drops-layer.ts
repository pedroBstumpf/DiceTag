import { Component, computed, inject, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DROP_SIZE, DroppedItem } from '../../../../../core/models/table-session.model';
import { WorldbuildService } from '../../../../worldbuild/services/worldbuild.service';
import { BlobUrlService } from '../../../services/blob-url.service';
import { TableSessionService } from '../../../services/table-session.service';
import { InventoryRow, inventoryRow, quantityOf } from '../../../utils/inventory';

/** Ponteiro pressionado sobre um item no chão. */
export interface DropPointerDown {
  event: PointerEvent;
  drop: DroppedItem;
}

/**
 * Camada dos itens largados no mapa (dentro do "mundo", abaixo da névoa e dos tokens).
 * Cada item é um losango com a imagem do cartão (ou o ícone de item) e a quantidade;
 * o hover mostra o nome. Só avisa o ponteiro — mover e abrir o cartão é roteado pelo map-stage.
 */
@Component({
  selector: 'app-drops-layer',
  imports: [MatIconModule, MatTooltipModule],
  host: { class: 'pointer-events-none absolute left-0 top-0' },
  template: `
    @for (d of drops(); track d.id) {
      @let px = size();
      @let row = rowOf(d);
      <div
        class="absolute"
        [class]="interactive() ? 'pointer-events-auto cursor-pointer' : 'pointer-events-none'"
        [style.left.px]="d.x - px / 2"
        [style.top.px]="d.y - px / 2"
        [style.width.px]="px"
        [style.height.px]="px"
        [style.transform]="upright() || null"
        [matTooltip]="row.name"
        matTooltipPosition="above"
        (pointerdown)="onDown($event, d)"
      >
        <!-- Losango com a imagem do item (ou o ícone) -->
        <div
          class="absolute inset-[14%] rotate-45 overflow-hidden border-amber-200/90 bg-ink-850 shadow-[0_0_14px_rgb(251_191_36/0.45)] transition-transform hover:scale-110"
          [style.border-width.px]="ui(2)"
        >
          @if (blobs.url(row.blobId); as src) {
            <img [src]="src" alt="" draggable="false" class="pointer-events-none size-full -rotate-45 scale-150 select-none object-cover" />
          } @else {
            <mat-icon class="!grid size-full -rotate-45 place-items-center text-amber-300" [style.font-size.px]="px * 0.36">inventory_2</mat-icon>
          }
        </div>
        <!-- Quantidade da pilha -->
        @if (quantityOf(d.item) > 1) {
          <span
            class="absolute rounded-full bg-ink-950/90 font-semibold leading-none tabular-nums text-amber-200 ring-1 ring-amber-300/50"
            [style.right.px]="0"
            [style.bottom.px]="0"
            [style.font-size.px]="legible(px * 0.22, 10)"
            [style.padding]="ui(2) + 'px ' + ui(5) + 'px'"
          >
            ×{{ quantityOf(d.item) }}
          </span>
        }
      </div>
    }
  `,
})
export class DropsLayer {
  private readonly session = inject(TableSessionService);
  private readonly worldbuild = inject(WorldbuildService);
  readonly blobs = inject(BlobUrlService);

  readonly drops = input.required<DroppedItem[]>();
  readonly scale = input.required<number>();
  readonly gridSize = input.required<number>();
  /** Itens recebem o ponteiro (ferramenta Selecionar). */
  readonly interactive = input(false);
  /** Vista isométrica: transformação CSS que deixa o item "em pé" (vazio na 2D). */
  readonly upright = input('');

  readonly dropDown = output<DropPointerDown>();

  readonly quantityOf = quantityOf;
  /** Lado do item em px do mundo (nunca menor que 28px na tela). */
  readonly size = computed(() => Math.max(DROP_SIZE * this.gridSize(), 28 / this.scale()));
  /** Originais dos itens (do mundo e da mesa), para nome e imagem. */
  private readonly sources = computed(() => ({ own: this.worldbuild.byId(), table: this.session.tableItemById() }));

  /** O item como o cartão o mostra (personalização ou original). */
  rowOf(drop: DroppedItem): InventoryRow {
    return inventoryRow(drop.item, this.sources());
  }

  /** Tamanho em px do mundo que aparece com `screenPx` na tela. */
  ui(screenPx: number): number {
    return screenPx / this.scale();
  }

  /** Tamanho proporcional ao item, mas nunca menor que `minScreenPx` na tela. */
  legible(worldPx: number, minScreenPx: number): number {
    return Math.max(worldPx, minScreenPx / this.scale());
  }

  onDown(event: PointerEvent, drop: DroppedItem): void {
    // Botão do meio continua movendo o mapa
    if (event.button !== 0) return;
    event.stopPropagation();
    this.dropDown.emit({ event, drop });
  }
}
