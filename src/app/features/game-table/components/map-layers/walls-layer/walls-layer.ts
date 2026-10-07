import { Component, computed, input } from '@angular/core';
import { Point } from '../../../../../core/models/geometry.model';
import { Wall } from '../../../../../core/models/table-session.model';
import { wallHandles } from '../../../utils/walls';

/** Parede em construção (ainda não salva). */
export type WallDraft =
  | { kind: 'line'; points: Point[]; cursor: Point | null }
  | { kind: 'circle'; cx: number; cy: number; r: number };

/**
 * Camada de paredes (SVG, dentro do "mundo"): linhas e círculos em azul
 * tracejado, discretos, mais a parede em construção e as alças da parede
 * selecionada. Não recebe ponteiro — criar, mover e apagar paredes é
 * roteado pelo map-stage.
 */
@Component({
  selector: 'app-walls-layer',
  host: { class: 'pointer-events-none absolute left-0 top-0' },
  template: `
    <svg class="absolute left-0 top-0 overflow-visible" width="1" height="1" fill="none" stroke-linecap="round" stroke-linejoin="round">
      @for (wall of walls(); track wall.id) {
        @let selected = editing() && wall.id === selectedId();
        @if (wall.kind === 'circle') {
          <circle
            [attr.cx]="wall.cx"
            [attr.cy]="wall.cy"
            [attr.r]="wall.r"
            [attr.stroke]="selected ? selectedColor : color"
            [attr.stroke-width]="ui(selected ? 3.5 : 2.5)"
            [attr.stroke-dasharray]="selected ? null : dash()"
          />
        } @else {
          <polyline
            [attr.points]="pointsAttr(wall.points)"
            [attr.stroke]="selected ? selectedColor : color"
            [attr.stroke-width]="ui(selected ? 3.5 : 2.5)"
            [attr.stroke-dasharray]="selected ? null : dash()"
          />
        }
      }

      <!-- Alças da parede selecionada (modo "Editar paredes") -->
      @for (h of handles(); track $index) {
        <circle [attr.cx]="h.x" [attr.cy]="h.y" [attr.r]="ui(6)" fill="#04060c" [attr.stroke]="selectedColor" [attr.stroke-width]="ui(2)" />
      }

      <!-- Parede em construção -->
      @if (draft(); as d) {
        @if (d.kind === 'line') {
          <polyline [attr.points]="draftPoints(d)" stroke="#f5f8ff" [attr.stroke-width]="ui(2.5)" />
          @for (p of d.points; track $index) {
            <circle [attr.cx]="p.x" [attr.cy]="p.y" [attr.r]="ui($first ? 6 : 4)" [attr.fill]="$first ? '#7aa7ff' : '#f5f8ff'" />
          }
        } @else {
          <circle [attr.cx]="d.cx" [attr.cy]="d.cy" [attr.r]="d.r" stroke="#f5f8ff" [attr.stroke-width]="ui(2.5)" />
        }
      }
    </svg>
  `,
})
export class WallsLayer {
  readonly walls = input.required<Wall[]>();
  readonly draft = input<WallDraft | null>(null);
  readonly scale = input.required<number>();
  /** Parede selecionada (destacada). */
  readonly selectedId = input<string | null>(null);
  /** Modo "Editar paredes": mostra as alças da parede selecionada. */
  readonly editing = input(false);

  readonly color = '#7aa7ff';
  readonly selectedColor = '#f5f8ff';

  /** Alças de edição (pontos da linha ou raio do círculo). */
  readonly handles = computed(() => {
    const wall = this.editing() && this.walls().find((w) => w.id === this.selectedId());
    return wall ? wallHandles(wall) : [];
  });

  /** Tamanho em px do mundo que aparece com `screenPx` na tela. */
  ui(screenPx: number): number {
    return screenPx / this.scale();
  }

  dash(): string {
    return `${this.ui(8)} ${this.ui(5)}`;
  }

  pointsAttr(points: Point[]): string {
    return points.map((p) => `${p.x},${p.y}`).join(' ');
  }

  /** Pontos da linha em construção, incluindo o trecho até o cursor. */
  draftPoints(draft: Extract<WallDraft, { kind: 'line' }>): string {
    return this.pointsAttr(draft.cursor ? [...draft.points, draft.cursor] : draft.points);
  }
}
