import { Component, DestroyRef, ElementRef, effect, inject, input, viewChild } from '@angular/core';
import { Point } from '../../../../../core/models/geometry.model';
import { ExploredMask, isCellExplored } from '../../../utils/fog-memory';

/** Limites do canvas: mapas grandes são desenhados em resolução menor. */
const MAX_SIDE = 4096;
const MAX_PIXELS = 6_000_000;
/** Suavização da borda da área visível (px do canvas). */
const SOFT_EDGE = 6;
/** Quanto da névoa as áreas já exploradas removem (jogador / mestre). */
const EXPLORED_REVEAL = { player: 0.55, gm: 0.35 };

/** Dados de um desenho da névoa. */
interface FogFrame {
  w: number;
  h: number;
  polygons: Point[][];
  explored: ExploredMask | null;
  player: boolean;
}

/**
 * Camada de névoa de guerra: um <canvas> do tamanho do mapa, dentro do "mundo".
 * Preenche a névoa e recorta (globalCompositeOperation = 'destination-out'):
 * - as áreas já exploradas, parcialmente (memória da névoa: mapa escurecido);
 * - as áreas visíveis agora, por completo, com bordas suavizadas.
 * Jogador: névoa opaca. Mestre: névoa semitransparente (~45%) e contorno das áreas visíveis.
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
  /** Áreas visíveis agora (polígonos em px do mapa). */
  readonly polygons = input.required<Point[][]>();
  /** Áreas já exploradas (memória da névoa). */
  readonly explored = input<ExploredMask | null>(null);
  /** Visão de jogador (opaca) ou de mestre (semitransparente com contornos). */
  readonly player = input(false);

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private frame = 0;
  /** Imagem da máscara explorada (refeita só quando a máscara muda). */
  private maskImage: { mask: ExploredMask; canvas: HTMLCanvasElement } | null = null;

  constructor() {
    effect(() => {
      // Lê os dados aqui (rastreados) e desenha no próximo quadro
      const data: FogFrame = {
        w: this.width(),
        h: this.height(),
        polygons: this.polygons(),
        explored: this.explored(),
        player: this.player(),
      };
      cancelAnimationFrame(this.frame);
      this.frame = requestAnimationFrame(() => this.draw(data));
    });
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(this.frame));
  }

  private draw({ w, h, polygons, explored, player }: FogFrame): void {
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
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.fillStyle = player ? 'rgba(4, 6, 12, 1)' : 'rgba(4, 6, 12, 0.45)';
    ctx.fillRect(0, 0, w, h);

    ctx.globalCompositeOperation = 'destination-out';
    ctx.filter = `blur(${SOFT_EDGE}px)`;

    // 2. Memória: áreas já exploradas ficam reveladas, mas escurecidas
    if (explored) {
      ctx.globalAlpha = player ? EXPLORED_REVEAL.player : EXPLORED_REVEAL.gm;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.exploredImage(explored), 0, 0, explored.cols * explored.cell, explored.rows * explored.cell);
      ctx.globalAlpha = 1;
    }

    // 3. Recorta as áreas visíveis agora (borda suavizada)
    ctx.fillStyle = '#000';
    for (const poly of polygons) this.trace(ctx, poly).fill();

    // 4. Mestre: contorno das áreas que os tokens enxergam
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

  /** Converte a máscara (1 pixel por célula) numa imagem, com cache. */
  private exploredImage(mask: ExploredMask): HTMLCanvasElement {
    if (this.maskImage?.mask === mask) return this.maskImage.canvas;
    const image = this.maskImage?.canvas ?? document.createElement('canvas');
    image.width = mask.cols;
    image.height = mask.rows;
    const ctx = image.getContext('2d')!;
    const pixels = ctx.createImageData(mask.cols, mask.rows);
    for (let r = 0; r < mask.rows; r++) {
      for (let c = 0; c < mask.cols; c++) {
        if (isCellExplored(mask, c, r)) pixels.data[(r * mask.cols + c) * 4 + 3] = 255;
      }
    }
    ctx.putImageData(pixels, 0, 0);
    this.maskImage = { mask, canvas: image };
    return image;
  }

  private trace(ctx: CanvasRenderingContext2D, poly: Point[]): CanvasRenderingContext2D {
    ctx.beginPath();
    poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    return ctx;
  }
}
