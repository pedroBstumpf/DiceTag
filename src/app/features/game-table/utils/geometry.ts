import { Point } from '../../../core/models/geometry.model';
import { MAX_TOKEN_SIZE, MIN_TOKEN_SIZE } from '../../../core/models/table-session.model';

/**
 * Geometria do mapa da mesa — funções puras, sem Angular.
 * Coordenadas sempre em pixels do mapa ("mundo").
 */

/**
 * Centro de um token alinhado à grade.
 * Tamanhos ímpares (1, 3…) e menores que 1 ficam no centro de um quadrado;
 * tamanhos pares (2, 4…) ficam no cruzamento das linhas.
 */
export function snapTokenCenter(p: Point, size: number, grid: number): Point {
  const onCorner = Math.round(size) % 2 === 0;
  const snap = (v: number) => (onCorner ? Math.round(v / grid) * grid : Math.floor(v / grid) * grid + grid / 2);
  return { x: snap(p.x), y: snap(p.y) };
}

/** Ponto alinhado ao canto de quadrado mais próximo (paredes). */
export function snapToCorner(p: Point, grid: number): Point {
  return { x: Math.round(p.x / grid) * grid, y: Math.round(p.y / grid) * grid };
}

/**
 * Tamanho do token a partir da alça de redimensionar: a distância do centro
 * até o ponteiro é meia largura. Passos de 0,5 quadrado, entre os limites.
 */
export function sizeFromHandle(center: Point, pointer: Point, grid: number): number {
  const half = Math.max(Math.abs(pointer.x - center.x), Math.abs(pointer.y - center.y));
  const size = Math.round(((2 * half) / grid) * 2) / 2;
  return Math.min(MAX_TOKEN_SIZE, Math.max(MIN_TOKEN_SIZE, size));
}

/** Distância de um ponto a um segmento. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distância de um ponto a uma polilinha (infinito se não houver pontos). */
export function distanceToPolyline(p: Point, points: Point[]): number {
  if (points.length === 1) return Math.hypot(p.x - points[0].x, p.y - points[0].y);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < points.length; i++) best = Math.min(best, distanceToSegment(p, points[i - 1], points[i]));
  return best;
}
