import { Component, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DoorWall } from '../../../../../core/models/table-session.model';

/**
 * Camada de portas (dentro do "mundo", acima dos tokens).
 * Sempre visível (diferente das paredes): a porta é desenhada como uma
 * faixa âmbar (sólida fechada, tracejada aberta) com um botão no meio,
 * de tamanho constante na tela, que abre/fecha a porta.
 */
@Component({
  selector: 'app-doors-layer',
  imports: [MatIconModule, MatTooltipModule],
  host: { class: 'pointer-events-none absolute left-0 top-0' },
  template: `
    <svg class="absolute left-0 top-0 overflow-visible" width="1" height="1" stroke-linecap="round">
      @for (door of doors(); track door.id) {
        <line
          [attr.x1]="door.points[0].x"
          [attr.y1]="door.points[0].y"
          [attr.x2]="door.points[1].x"
          [attr.y2]="door.points[1].y"
          stroke="#f59e0b"
          [attr.stroke-width]="ui(door.open ? 2 : 5)"
          [attr.stroke-dasharray]="door.open ? ui(6) + ' ' + ui(6) : null"
          [attr.stroke-opacity]="door.open ? 0.6 : 1"
        />
      }
    </svg>

    <!-- Botões de abrir/fechar (escala inversa: tamanho constante na tela) -->
    @for (door of doors(); track door.id) {
      <div
        class="absolute"
        [style.left.px]="(door.points[0].x + door.points[1].x) / 2"
        [style.top.px]="(door.points[0].y + door.points[1].y) / 2"
        [style.transform]="'translate(-50%, -50%) scale(' + 1 / scale() + ')'"
      >
        <button
          type="button"
          class="grid size-7 place-items-center rounded-full border border-amber-400/70 bg-ink-950/90 text-amber-300 shadow-md shadow-black/60 transition-transform hover:scale-110"
          [class]="interactive() ? 'pointer-events-auto cursor-pointer' : 'pointer-events-none'"
          [matTooltip]="door.open ? 'Fechar porta' : 'Abrir porta'"
          [attr.aria-label]="door.open ? 'Fechar porta' : 'Abrir porta'"
          (pointerdown)="onDown($event, door)"
        >
          <mat-icon class="!size-[18px] !text-[18px]">{{ door.open ? 'door_open' : 'door_front' }}</mat-icon>
        </button>
      </div>
    }
  `,
})
export class DoorsLayer {
  readonly doors = input.required<DoorWall[]>();
  readonly scale = input.required<number>();
  /** Botões recebem o ponteiro (ferramenta Selecionar). */
  readonly interactive = input(false);

  /** Pedido para abrir/fechar a porta. */
  readonly toggled = output<string>();

  /** Tamanho em px do mundo que aparece com `screenPx` na tela. */
  ui(screenPx: number): number {
    return screenPx / this.scale();
  }

  onDown(event: PointerEvent, door: DoorWall): void {
    if (event.button !== 0) return;
    event.stopPropagation();
    this.toggled.emit(door.id);
  }
}
