import { Wall } from '../../../core/models/table-session.model';
import { circleToPolygon, computeVisibilityPolygon, pointInPolygon, wallsToSegments } from './visibility';

const origin = { x: 0, y: 0 };

/** O ponto está dentro da área visível a partir da origem? */
function sees(walls: Wall[], range: number, target: { x: number; y: number }): boolean {
  return pointInPolygon(target, computeVisibilityPolygon(origin, range, wallsToSegments(walls)));
}

describe('visibility', () => {
  it('sala vazia: enxerga em todas as direções até o alcance', () => {
    const poly = computeVisibilityPolygon(origin, 100, []);
    for (const p of poly) expect(Math.hypot(p.x, p.y)).toBeCloseTo(100);
    expect(sees([], 100, { x: 60, y: 0 })).toBe(true);
    expect(sees([], 100, { x: -40, y: -40 })).toBe(true);
  });

  it('parede bloqueia o que está atrás dela', () => {
    const wall: Wall = { id: 'w', kind: 'line', points: [{ x: 50, y: -100 }, { x: 50, y: 100 }] };
    expect(sees([wall], 300, { x: 30, y: 0 })).toBe(true);
    expect(sees([wall], 300, { x: 100, y: 0 })).toBe(false);
    expect(sees([wall], 300, { x: -100, y: 0 })).toBe(true);
  });

  it('abertura na parede (porta) deixa a visão passar', () => {
    const walls: Wall[] = [
      { id: 'a', kind: 'line', points: [{ x: 50, y: -200 }, { x: 50, y: -20 }] },
      { id: 'b', kind: 'line', points: [{ x: 50, y: 20 }, { x: 50, y: 200 }] },
    ];
    expect(sees(walls, 300, { x: 150, y: 0 })).toBe(true);
    expect(sees(walls, 300, { x: 150, y: 120 })).toBe(false);
  });

  it('pilar circular projeta sombra', () => {
    const pillar: Wall = { id: 'p', kind: 'circle', cx: 100, cy: 0, r: 20 };
    expect(sees([pillar], 300, { x: 200, y: 0 })).toBe(false);
    expect(sees([pillar], 300, { x: 0, y: 150 })).toBe(true);
    expect(sees([pillar], 300, { x: 60, y: 0 })).toBe(true);
  });

  it('alcance limita a visão', () => {
    expect(sees([], 100, { x: 90, y: 0 })).toBe(true);
    expect(sees([], 100, { x: 150, y: 0 })).toBe(false);
  });

  it('círculo vira polígono de 24 lados', () => {
    const poly = circleToPolygon(0, 0, 10);
    expect(poly).toHaveLength(24);
    for (const p of poly) expect(Math.hypot(p.x, p.y)).toBeCloseTo(10);
  });

  it('pointInPolygon distingue dentro e fora', () => {
    const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false);
  });
});
