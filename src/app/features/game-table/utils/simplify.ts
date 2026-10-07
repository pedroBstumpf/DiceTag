import { Point } from '../../../core/models/geometry.model';
import { distanceToSegment } from './geometry';

/**
 * Simplifica uma polilinha (Ramer–Douglas–Peucker): remove pontos que
 * desviam menos que `tolerance` da reta entre os vizinhos mantidos.
 * Usado ao finalizar traços de desenho, para não inflar o armazenamento.
 * Função pura, iterativa (sem recursão profunda em traços longos).
 */
export function simplifyPath(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points.slice();

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];

  while (stack.length) {
    const [start, end] = stack.pop()!;
    let maxDist = 0;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const d = distanceToSegment(points[i], points[start], points[end]);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    // O ponto mais distante é relevante: mantém e divide o trecho em dois
    if (index !== -1 && maxDist > tolerance) {
      keep[index] = 1;
      stack.push([start, index], [index, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}
