import { Component, computed, inject, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DROP_COLOR, DROP_SIZE, DroppedItem } from '../../../../../core/models/table-session.model';
import { WorldbuildService } from '../../../../worldbuild/services/worldbuild.service';
import { BlobUrlService } from '../../../services/blob-url.service';
import { TableSessionService } from '../../../services/table-session.service';
import { InventoryRow, inventoryRow, quantityOf } from '../../../utils/inventory';

/** Ponteiro pressionado sobre um item no chão (corpo ou alça de redimensionar). */
export interface DropPointerDown {
  event: PointerEvent;
  drop: DroppedItem;
  mode: 'move' | 'resize';
}

/**
 * Camada dos itens largados no mapa (dentro do "mundo", abaixo da névoa e dos tokens).
 * Cada item é um losango com a imagem do cartão (ou o ícone de item), a borda na cor
 * escolhida e a quantidade; o hover mostra o nome. O selecionado ganha o anel azul e,
 * para quem pode mexer (mestre), a alça de redimensionar. Só avisa o ponteiro — mover,
 * redimensionar e abrir o cartão é roteado pelo map-stage.
 */
@Component({
  selector: 'app-drops-layer',
  imports: [MatIconModule, MatTooltipModule],
  host: { class: 'pointer-events-none absolute left-0 top-0' },
  template: `
    @for (d of drops(); track d.id) {
      @let px = sizeOf(d);
      @let row = rowOf(d);
      @let color = d.color ?? defaultColor;
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
        (pointerdown)="onDown($event, d, 'move')"
      >
        <!-- Losango com a imagem do item (ou o ícone), borda na cor escolhida -->
        <div
          class="absolute inset-[14%] rotate-45 overflow-hidden bg-ink-850 transition-transform hover:scale-110"
          [style.border-width.px]="ui(2)"
          [style.border-color]="color"
          [style.box-shadow]="'0 0 ' + ui(14) + 'px ' + color"
        >
          @if (blobs.url(row.blobId); as src) {
            <img [src]="src" alt="" draggable="false" class="pointer-events-none size-full -rotate-45 scale-150 select-none object-cover" />
          } @else {
            <mat-icon class="!grid size-full -rotate-45 place-items-center" [style.color]="color" [style.font-size.px]="px * 0.36">inventory_2</mat-icon>
          }
        </div>

        <!-- Anel de seleção (losango) -->
        @if (selectedId() === d.id) {
          <span
            class="pointer-events-none absolute inset-[6%] rotate-45 border-astral-400 shadow-[0_0_12px_rgb(122_167_255/0.7)]"
            [style.border-width.px]="ui(2.5)"
          ></span>
        }

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

        <!-- Alça de redimensionar (item selecionado, só para quem pode mexer) -->
        @if (selectedId() === d.id && interactive() && editable()) {
          <span
            class="absolute cursor-nwse-resize rounded-sm border-white bg-astral-500"
            [style.width.px]="ui(12)"
            [style.height.px]="ui(12)"
            [style.right.px]="ui(-6)"
            [style.bottom.px]="ui(-6)"
            [style.border-width.px]="ui(1.5)"
            (pointerdown)="onDown($event, d, 'resize')"
          ></span>
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
  /** A conta pode mover/redimensionar os itens (mestre). */
  readonly editable = input(false);
  /** Item selecionado (anel e alça). */
  readonly selectedId = input<string | null>(null);
  /** Vista isométrica: transformação CSS que deixa o item "em pé" (vazio na 2D). */
  readonly upright = input('');

  readonly dropDown = output<DropPointerDown>();

  readonly quantityOf = quantityOf;
  readonly defaultColor = DROP_COLOR;
  /** Originais dos itens (do mundo e da mesa), para nome e imagem. */
  private readonly sources = computed(() => ({ own: this.worldbuild.byId(), table: this.session.tableItemById() }));

  /** Lado do item em px do mundo (nunca menor que 28px na tela). */
  sizeOf(drop: DroppedItem): number {
    return Math.max((drop.size ?? DROP_SIZE) * this.gridSize(), 28 / this.scale());
  }

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

  onDown(event: PointerEvent, drop: DroppedItem, mode: DropPointerDown['mode']): void {
    // Botão do meio continua movendo o mapa
    if (event.button !== 0) return;
    event.stopPropagation();
    this.dropDown.emit({ event, drop, mode });
  }
}
