import { Point } from '../../../core/models/geometry.model';
import { Wall } from '../../../core/models/table-session.model';
import { distanceToPolyline } from './geometry';

/**
 * Edição de paredes — funções puras, sem Angular.
 * Paredes em linha têm uma alça por ponto; círculos têm uma alça de raio
 * (à direita do centro). Arrastar o corpo da parede move a parede inteira.
 */

/** Move a parede inteira. */
export function translateWall(wall: Wall, dx: number, dy: number): Wall {
  if (wall.kind === 'circle') return { ...wall, cx: wall.cx + dx, cy: wall.cy + dy };
  return { ...wall, points: wall.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) } as Wall;
}

/** Pontos editáveis da parede (alças). */
export function wallHandles(wall: Wall): Point[] {
  return wall.kind === 'circle' ? [{ x: wall.cx + wall.r, y: wall.cy }] : wall.points;
}

/** Move uma alça da parede para `p` (círculo: a alça define o raio). */
export function moveWallHandle(wall: Wall, index: number, p: Point): Wall {
  if (wall.kind === 'circle') return { ...wall, r: Math.max(1, Math.hypot(p.x - wall.cx, p.y - wall.cy)) };
  return { ...wall, points: wall.points.map((q, i) => (i === index ? { x: p.x, y: p.y } : q)) } as Wall;
}

/** Distância do ponto até a parede (para clicar nela). */
export function distanceToWall(wall: Wall, p: Point): number {
  if (wall.kind === 'circle') return Math.abs(Math.hypot(p.x - wall.cx, p.y - wall.cy) - wall.r);
  return distanceToPolyline(p, wall.points);
}

/** Índice da alça sob o ponto (ou -1). */
export function handleAt(wall: Wall, p: Point, tolerance: number): number {
  return wallHandles(wall).findIndex((h) => Math.hypot(h.x - p.x, h.y - p.y) <= tolerance);
}
