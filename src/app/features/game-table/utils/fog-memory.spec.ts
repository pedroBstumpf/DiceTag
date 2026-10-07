import { createMask, decodeMask, encodeMask, isExploredAt, markPolygons, maskFits } from './fog-memory';

const square = (x: number, y: number, size: number) => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];

describe('fog-memory', () => {
  it('cria máscara vazia com células de no mínimo 10px', () => {
    const mask = createMask(2100, 1400);
    expect(mask.cell).toBe(10);
    expect(mask.cols).toBe(210);
    expect(mask.rows).toBe(140);
    expect(isExploredAt(mask, { x: 50, y: 50 })).toBe(false);
  });

  it('marca a área dentro do polígono e só ela', () => {
    const mask = createMask(1000, 1000);
    expect(markPolygons(mask, [square(100, 100, 200)])).toBe(true);
    expect(isExploredAt(mask, { x: 200, y: 200 })).toBe(true);
    expect(isExploredAt(mask, { x: 500, y: 500 })).toBe(false);
    expect(isExploredAt(mask, { x: 50, y: 200 })).toBe(false);
  });

  it('retorna false quando nada novo foi marcado', () => {
    const mask = createMask(1000, 1000);
    markPolygons(mask, [square(100, 100, 200)]);
    expect(markPolygons(mask, [square(120, 120, 50)])).toBe(false);
  });

  it('acumula áreas exploradas (memória)', () => {
    const mask = createMask(1000, 1000);
    markPolygons(mask, [square(0, 0, 100)]);
    markPolygons(mask, [square(500, 500, 100)]);
    expect(isExploredAt(mask, { x: 50, y: 50 })).toBe(true);
    expect(isExploredAt(mask, { x: 550, y: 550 })).toBe(true);
  });

  it('encode/decode preservam a máscara', () => {
    const mask = createMask(800, 600);
    markPolygons(mask, [square(100, 100, 300)]);
    const back = decodeMask(encodeMask(mask));
    expect(back.bits).toEqual(mask.bits);
    expect(isExploredAt(back, { x: 250, y: 250 })).toBe(true);
  });

  it('maskFits detecta troca de tamanho do mapa', () => {
    const mask = createMask(2100, 1400);
    expect(maskFits(mask, 2100, 1400)).toBe(true);
    expect(maskFits(mask, 4000, 3000)).toBe(false);
  });
});
