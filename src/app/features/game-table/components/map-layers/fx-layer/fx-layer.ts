import { NgTemplateOutlet } from '@angular/common';
import { Component, Directive, ElementRef, Renderer2, computed, effect, inject, input } from '@angular/core';
import { Point } from '../../../../../core/models/geometry.model';
import { FxStyle } from '../../../../../core/models/table-session.model';
import { FxInstance } from '../../../services/table-session.service';
import { FxPart, fxCss, isRadialFx } from '../../../utils/effects';
import { Mat2 } from '../../../utils/projection';

/** Efeito sendo mirado (arraste em andamento). */
export interface FxDraft {
  from: Point;
  to: Point;
}

/**
 * Aplica os atributos e o CSS de uma parte do efeito (descrita em utils/effects.ts)
 * no elemento SVG. As partes não mudam depois de criadas.
 */
@Directive({ selector: '[appFxPart]' })
export class FxPartAttrs {
  readonly appFxPart = input.required<FxPart>();
  private readonly el = inject<ElementRef<SVGElement>>(ElementRef);
  private readonly renderer = inject(Renderer2);

  constructor() {
    effect(() => {
      const part = this.appFxPart();
      const node = this.el.nativeElement;
      for (const [name, value] of Object.entries(part.attrs)) this.renderer.setAttribute(node, name, String(value));
      const css = fxCss(part);
      if (css) this.renderer.setAttribute(node, 'style', css);
    });
  }
}

/**
 * Camada de efeitos especiais (dentro do "mundo" do mapa).
 * Só desenha: cada efeito já chega pronto (`FxInstance.drawing`, montado por
 * utils/effects.ts no lançamento) e some sozinho — a sessão o remove ao terminar.
 * Também desenha a mira enquanto o usuário arrasta.
 */
@Component({
  selector: 'app-fx-layer',
  imports: [NgTemplateOutlet, FxPartAttrs],
  host: { class: 'pointer-events-none absolute left-0 top-0' },
  template: `
    <svg class="absolute left-0 top-0 overflow-visible" [attr.width]="width()" [attr.height]="height()">
      <defs>
        <!-- Brilho: região em coordenadas do mapa (linhas retas têm caixa de altura zero) -->
        <filter id="dt-fx-glow" filterUnits="userSpaceOnUse" x="-100000" y="-100000" width="200000" height="200000">
          <feGaussianBlur [attr.stdDeviation]="ui(4)" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        @for (fx of effects(); track fx.id) {
          @for (g of fx.drawing.gradients; track g.id) {
            @if (g.type === 'radial') {
              <radialGradient [attr.id]="g.id">
                @for (s of g.stops; track $index) {
                  <stop [attr.offset]="s.offset" [attr.stop-color]="s.color" [attr.stop-opacity]="s.opacity ?? 1" />
                }
              </radialGradient>
            } @else {
              <linearGradient [attr.id]="g.id" x1="0" y1="0" [attr.x2]="g.vertical ? 0 : 1" [attr.y2]="g.vertical ? 1 : 0">
                @for (s of g.stops; track $index) {
                  <stop [attr.offset]="s.offset" [attr.stop-color]="s.color" [attr.stop-opacity]="s.opacity ?? 1" />
                }
              </linearGradient>
            }
          }
        }
      </defs>

      @for (fx of effects(); track fx.id) {
        <g [attr.transform]="transformOf(fx)">
          @for (p of fx.drawing.parts; track $index) {
            <ng-container *ngTemplateOutlet="part; context: { $implicit: p }" />
          }
        </g>
      }

      <!-- Mira do efeito em andamento -->
      @if (draft(); as d) {
        @let c = current();
        <g opacity="0.85">
          @if (radial()) {
            <circle [attr.cx]="d.from.x" [attr.cy]="d.from.y" [attr.r]="distance(d)" fill="none" [attr.stroke]="c.color" [attr.stroke-width]="ui(2)" [attr.stroke-dasharray]="ui(8) + ' ' + ui(6)" />
          }
          <line [attr.x1]="d.from.x" [attr.y1]="d.from.y" [attr.x2]="d.to.x" [attr.y2]="d.to.y" [attr.stroke]="c.color" [attr.stroke-width]="ui(2)" [attr.stroke-dasharray]="ui(8) + ' ' + ui(6)" />
          <circle [attr.cx]="d.from.x" [attr.cy]="d.from.y" [attr.r]="ui(5)" [attr.fill]="c.color" />
        </g>
      }
    </svg>

    <!-- Uma parte do efeito (recursivo: grupos têm filhos) -->
    <ng-template #part let-p>
      @switch (p.tag) {
        @case ('g') {
          <svg:g [appFxPart]="p">
            @for (c of p.children; track $index) {
              <ng-container *ngTemplateOutlet="part; context: { $implicit: c }" />
            }
          </svg:g>
        }
        @case ('path') {
          <svg:path [appFxPart]="p" />
        }
        @case ('circle') {
          <svg:circle [appFxPart]="p" />
        }
        @case ('ellipse') {
          <svg:ellipse [appFxPart]="p" />
        }
        @case ('line') {
          <svg:line [appFxPart]="p" />
        }
        @case ('polyline') {
          <svg:polyline [appFxPart]="p" />
        }
        @case ('polygon') {
          <svg:polygon [appFxPart]="p" />
        }
        @case ('rect') {
          <svg:rect [appFxPart]="p" />
        }
      }
    </ng-template>
  `,
})
export class FxLayer {
  readonly effects = input.required<FxInstance[]>();
  /** Mira do lançamento em andamento. */
  readonly draft = input<FxDraft | null>(null);
  /** Forma e cor do próximo lançamento (para desenhar a mira). */
  readonly current = input.required<FxStyle>();
  readonly scale = input.required<number>();
  readonly width = input.required<number>();
  readonly height = input.required<number>();
  /** Vista isométrica: matriz que deixa efeitos "em pé" (null na 2D). */
  readonly upright = input<Mat2 | null>(null);

  /** Posição do efeito; os que sobem ficam de pé na vista isométrica. */
  transformOf(fx: FxInstance): string {
    const m = this.upright();
    if (!m || !fx.drawing.upright) return fx.drawing.transform;
    return `${fx.drawing.transform} matrix(${m[0]} ${m[1]} ${m[2]} ${m[3]} 0 0)`;
  }

  /** A forma atual usa centro + raio (mira em círculo)? */
  readonly radial = computed(() => isRadialFx(this.current().kind));

  /** Tamanho em px do mapa que aparece com `screenPx` na tela. */
  ui(screenPx: number): number {
    return screenPx / this.scale();
  }

  distance(d: FxDraft): number {
    return Math.hypot(d.to.x - d.from.x, d.to.y - d.from.y);
  }
}
