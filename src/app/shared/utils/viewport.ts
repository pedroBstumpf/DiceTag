import { Point, Rect } from '../../core/models/geometry.model';

/**
 * Funções puras de pan/zoom, usadas pelo mapa da mesa, pelo visualizador
 * de imagens e pelo quadro da linha do tempo.
 *
 * Uma "vista" é a transformação do mundo para a tela:
 *   tela = mundo × scale + (x, y)
 */
export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

/** Zoom mantendo fixo o ponto da tela (px, py), dentro dos limites de escala. */
export function zoomAt(view: Viewport, factor: number, px: number, py: number, minScale: number, maxScale: number): Viewport {
  const scale = Math.min(maxScale, Math.max(minScale, view.scale * factor));
  const k = scale / view.scale;
  return { scale, x: px - (px - view.x) * k, y: py - (py - view.y) * k };
}

/** Converte um ponto da tela (relativo à área) para coordenadas do mundo. */
export function screenToWorld(view: Viewport, sx: number, sy: number): Point {
  return { x: (sx - view.x) / view.scale, y: (sy - view.y) / view.scale };
}

/** Converte um ponto do mundo para a tela (relativo à área). */
export function worldToScreen(view: Viewport, p: Point): Point {
  return { x: p.x * view.scale + view.x, y: p.y * view.scale + view.y };
}

/**
 * Vista que enquadra `content` (mundo) centralizado em `area` (tela).
 * `fill` deixa uma margem (0.95 = ocupa 95%); `maxScale` evita ampliar demais.
 */
export function fitRect(content: Rect, area: Rect, fill = 0.95, maxScale = Infinity): Viewport {
  const width = Math.max(content.width, 1);
  const height = Math.max(content.height, 1);
  const fit = Math.min(area.width / width, area.height / height) * fill;
  const scale = Math.max(Math.min(fit, maxScale), 0.01);
  return {
    scale,
    x: area.x + (area.width - width * scale) / 2 - content.x * scale,
    y: area.y + (area.height - height * scale) / 2 - content.y * scale,
  };
}
