import { Point } from '../../../core/models/geometry.model';
import { Viewport } from '../../../shared/utils/viewport';

/**
 * Projeção do mapa: 2D (identidade) ou isométrica (gira 45° e achata na vertical,
 * como uma mesa vista de lado). Funções puras.
 *
 * Matriz 2×2 na ordem do CSS `matrix(a, b, c, d, …)`:
 *   x' = a·x + c·y    y' = b·x + d·y
 * Tela = vista.scale × M × mundo + (vista.x, vista.y).
 * O zoom no cursor (`zoomAt`) e o pan não dependem de M; só a conversão
 * tela↔mundo e o enquadramento precisam dela.
 */
export type Mat2 = readonly [number, number, number, number];

export const IDENTITY: Mat2 = [1, 0, 0, 1];

/** Achatamento vertical da vista isométrica (0.5 = isométrico clássico de jogo). */
export const ISO_SQUASH = 0.58;
/** Achatamento dos tokens "em pé" na vista isométrica (leve, como peças numa mesa). */
export const TOKEN_TILT = 0.84;

/** Matriz isométrica: gira 45° e achata a vertical. */
export function isoMatrix(squash = ISO_SQUASH): Mat2 {
  const s = Math.SQRT1_2;
  return [s, s * squash, -s, s * squash];
}

export function apply(m: Mat2, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y, y: m[1] * p.x + m[3] * p.y };
}

export function invert(m: Mat2): Mat2 {
  const det = m[0] * m[3] - m[1] * m[2];
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det];
}

/** Produto m × n (aplica n primeiro). */
export function multiply(m: Mat2, n: Mat2): Mat2 {
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3]];
}

/** Mundo → tela (relativo à área do mapa). `lift` desloca na vertical (camadas). */
export function project(view: Viewport, m: Mat2, p: Point, lift = 0): Point {
  const q = apply(m, p);
  return { x: q.x * view.scale + view.x, y: q.y * view.scale + view.y + lift };
}

/** Tela → mundo (relativo à área do mapa). */
export function unproject(view: Viewport, m: Mat2, sx: number, sy: number): Point {
  return apply(invert(m), { x: (sx - view.x) / view.scale, y: (sy - view.y) / view.scale });
}

/** Caixa (na tela, escala 1, sem deslocamento) do retângulo do mundo projetado. */
export function projectedBounds(m: Mat2, width: number, height: number) {
  const corners = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: 0, y: height }, { x: width, y: height }].map((p) => apply(m, p));
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

/** CSS `matrix(...)` da vista inteira (mundo → tela). */
export function viewCss(view: Viewport, m: Mat2, lift = 0): string {
  const s = view.scale;
  return `matrix(${m[0] * s}, ${m[1] * s}, ${m[2] * s}, ${m[3] * s}, ${view.x}, ${view.y + lift})`;
}

/**
 * Transformação que deixa um elemento do mundo "em pé" (desfaz a rotação da vista)
 * com um leve achatamento. Na vista 2D, nenhuma. Para CSS (`matrix(a,b,c,d,0,0)`).
 */
export function uprightMatrix(m: Mat2, tilt = TOKEN_TILT): Mat2 | null {
  if (m === IDENTITY) return null;
  return multiply(invert(m), [1, 0, 0, tilt]);
}

export function matrixCss(m: Mat2 | null): string {
  return m ? `matrix(${m[0]}, ${m[1]}, ${m[2]}, ${m[3]}, 0, 0)` : '';
}
