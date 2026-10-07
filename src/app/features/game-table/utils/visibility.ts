import { Point } from '../../../core/models/geometry.model';
import { Wall } from '../../../core/models/table-session.model';
import { distanceToSegment } from './geometry';

/**
 * Cálculo de visão para a névoa de guerra — funções puras, sem Angular.
 * Coordenadas em pixels do mapa.
 */

/** Segmento de parede (bloqueia raios de visão). */
export interface Segment {
  a: Point;
  b: Point;
}

/** Desvio angular dos raios extras lançados ao lado de cada vértice (contorna quinas). */
const EPSILON = 1e-4;
/** Raios uniformes que desenham a borda circular do alcance. */
const RANGE_RAYS = 64;
/** Lados do polígono que aproxima uma parede circular. */
export const CIRCLE_SIDES = 24;

/** Polígono regular que aproxima um círculo. */
export function circleToPolygon(cx: number, cy: number, r: number, sides = CIRCLE_SIDES): Point[] {
  return Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  });
}

/** Converte paredes (polilinhas e círculos) em segmentos. */
export function wallsToSegments(walls: Wall[]): Segment[] {
  const segments: Segment[] = [];
  for (const wall of walls) {
    if (wall.kind === 'line') {
      for (let i = 1; i < wall.points.length; i++) segments.push({ a: wall.points[i - 1], b: wall.points[i] });
    } else {
      const poly = circleToPolygon(wall.cx, wall.cy, wall.r);
      poly.forEach((p, i) => segments.push({ a: p, b: poly[(i + 1) % poly.length] }));
    }
  }
  return segments;
}

/**
 * Polígono visível a partir de `origin` (ray casting).
 * Lança um raio para cada vértice de parede (e dois com desvio ±ε, para
 * passar pelas quinas), mais raios uniformes para a borda do alcance.
 * Cada raio para na parede mais próxima ou no alcance.
 */
export function computeVisibilityPolygon(origin: Point, range: number, segments: Segment[]): Point[] {
  // Só paredes que alcançam o círculo de visão influenciam o resultado
  const near = segments.filter((s) => distanceToSegment(origin, s.a, s.b) < range);

  const angles: number[] = [];
  for (let i = 0; i < RANGE_RAYS; i++) angles.push(-Math.PI + (i / RANGE_RAYS) * Math.PI * 2);
  for (const s of near) {
    for (const p of [s.a, s.b]) {
      const a = Math.atan2(p.y - origin.y, p.x - origin.x);
      angles.push(a - EPSILON, a, a + EPSILON);
    }
  }
  angles.sort((x, y) => x - y);

  return angles.map((angle) => {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let dist = range;
    for (const s of near) {
      const t = raySegment(origin, dx, dy, s);
      if (t !== null && t < dist) dist = t;
    }
    return { x: origin.x + dx * dist, y: origin.y + dy * dist };
  });
}

/** Ponto dentro de um polígono (regra par-ímpar). */
export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Distância ao longo do raio até o segmento (null se não cruzar). */
function raySegment(o: Point, dx: number, dy: number, s: Segment): number | null {
  const sx = s.b.x - s.a.x;
  const sy = s.b.y - s.a.y;
  const denom = dx * sy - dy * sx;
  if (Math.abs(denom) < 1e-12) return null; // paralelos
  const qx = s.a.x - o.x;
  const qy = s.a.y - o.y;
  const t = (qx * sy - qy * sx) / denom;
  const u = (qx * dy - qy * dx) / denom;
  return t >= 0 && u >= 0 && u <= 1 ? t : null;
}
