import { Component, input } from '@angular/core';
import { Point } from '../../../../../core/models/geometry.model';
import { Stroke } from '../../../../../core/models/table-session.model';

/** Traço em andamento (ainda não salvo). */
export type StrokeDraft = Omit<Stroke, 'id'>;

/**
 * Camada de desenhos livres (SVG, dentro do "mundo", abaixo da névoa e dos tokens).
 * Desenha os traços salvos e o traço em andamento em tempo real.
 * Não recebe ponteiro — desenhar e apagar é roteado pelo map-stage.
 */
@Component({
  selector: 'app-drawings-layer',
  host: { class: 'pointer-events-none absolute left-0 top-0' },
  template: `
    <svg class="absolute left-0 top-0 overflow-visible" width="1" height="1" fill="none" stroke-linecap="round" stroke-linejoin="round">
      @for (stroke of strokes(); track stroke.id) {
        @if (!hidden().has(stroke.id)) {
          <path [attr.d]="pathOf(stroke.points)" [attr.stroke]="stroke.color" [attr.stroke-width]="stroke.width" [attr.stroke-opacity]="stroke.opacity" />
        }
      }
      @if (draft(); as d) {
        <path [attr.d]="pathOf(d.points)" [attr.stroke]="d.color" [attr.stroke-width]="d.width" [attr.stroke-opacity]="d.opacity" />
      }
    </svg>
  `,
})
export class DrawingsLayer {
  readonly strokes = input.required<Stroke[]>();
  readonly draft = input<StrokeDraft | null>(null);
  /** Traços tocados pela borracha durante o gesto (removidos ao soltar). */
  readonly hidden = input<ReadonlySet<string>>(new Set());

  /** Caminho SVG da polilinha (um ponto só vira um traço mínimo, desenhado como um pingo). */
  pathOf(points: Point[]): string {
    if (!points.length) return '';
    const [first, ...rest] = points;
    const tail = rest.length ? rest : [first];
    return `M${first.x},${first.y}` + tail.map((p) => `L${p.x},${p.y}`).join('');
  }
}
