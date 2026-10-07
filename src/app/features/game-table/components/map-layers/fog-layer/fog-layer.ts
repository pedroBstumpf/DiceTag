import { Component, DestroyRef, ElementRef, effect, inject, input, viewChild } from '@angular/core';
import { Point } from '../../../../../core/models/geometry.model';

/** Limites do canvas: mapas grandes são desenhados em resolução menor. */
const MAX_SIDE = 4096;
const MAX_PIXELS = 6_000_000;
/** Suavização da borda da área visível (px do canvas). */
const SOFT_EDGE = 6;

/**
 * Camada de névoa de guerra: um <canvas> do tamanho do mapa, dentro do "mundo".
 * Preenche a névoa e recorta as áreas visíveis dos tokens
 * (globalCompositeOperation = 'destination-out'), com bordas suavizadas.
 * - Jogador: névoa opaca.
 * - Mestre: névoa semitransparente (~45%) e contorno das áreas visíveis.
 * Redesenha só quando os dados mudam, agrupando num requestAnimationFrame.
 */
@Component({
  selector: 'app-fog-layer',
  host: { class: 'pointer-events-none absolute left-0 top-0' },
  template: `<canvas #canvas class="absolute left-0 top-0" [style.width.px]="width()" [style.height.px]="height()"></canvas>`,
})
export class FogLayer {
  readonly width = input.required<number>();
  readonly height = input.required<number>();
  /** Áreas visíveis (polígonos em px do mapa). */
  readonly polygons = input.required<Point[][]>();
  /** Visão de jogador (opaca) ou de mestre (semitransparente com contornos). */
  readonly player = input(false);

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private frame = 0;

  constructor() {
    effect(() => {
      // Lê os dados aqui (rastreados) e desenha no próximo quadro
      const data = { w: this.width(), h: this.height(), polygons: this.polygons(), player: this.player() };
      cancelAnimationFrame(this.frame);
      this.frame = requestAnimationFrame(() => this.draw(data));
    });
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(this.frame));
  }

  private draw({ w, h, polygons, player }: { w: number; h: number; polygons: Point[][]; player: boolean }): void {
    const canvas = this.canvas().nativeElement;
    // Resolução proporcional, limitada para não estourar memória em mapas grandes
    const k = Math.min(1, MAX_SIDE / Math.max(w, h), Math.sqrt(MAX_PIXELS / (w * h)));
    const cw = Math.max(1, Math.round(w * k));
    const ch = Math.max(1, Math.round(h * k));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.setTransform(k, 0, 0, k, 0, 0);

    // 1. Névoa sobre o mapa inteiro
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.fillStyle = player ? 'rgba(4, 6, 12, 1)' : 'rgba(4, 6, 12, 0.45)';
    ctx.fillRect(0, 0, w, h);

    // 2. Recorta as áreas visíveis (borda suavizada)
    ctx.globalCompositeOperation = 'destination-out';
    ctx.filter = `blur(${SOFT_EDGE}px)`;
    ctx.fillStyle = '#000';
    for (const poly of polygons) this.trace(ctx, poly).fill();

    // 3. Mestre: contorno das áreas que os tokens enxergam
    if (!player) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.filter = 'none';
      ctx.strokeStyle = 'rgba(169, 199, 255, 0.55)';
      ctx.lineWidth = Math.max(2, Math.max(w, h) / 1200);
      ctx.setLineDash([12, 8]);
      for (const poly of polygons) this.trace(ctx, poly).stroke();
      ctx.setLineDash([]);
    }
  }

  private trace(ctx: CanvasRenderingContext2D, poly: Point[]): CanvasRenderingContext2D {
    ctx.beginPath();
    poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    return ctx;
  }
}
