import { simplifyPath } from './simplify';

describe('simplifyPath', () => {
  it('reduz uma linha reta aos dois extremos', () => {
    const line = Array.from({ length: 50 }, (_, i) => ({ x: i, y: 0 }));
    expect(simplifyPath(line, 0.5)).toEqual([{ x: 0, y: 0 }, { x: 49, y: 0 }]);
  });

  it('mantém cantos relevantes', () => {
    const corner = [
      { x: 0, y: 0 },
      { x: 5, y: 0.1 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 10, y: 10 },
    ];
    expect(simplifyPath(corner, 0.5)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
  });

  it('não altera traços com até dois pontos', () => {
    const dot = [{ x: 3, y: 3 }];
    expect(simplifyPath(dot, 1)).toEqual(dot);
    expect(simplifyPath(dot, 1)).not.toBe(dot);
  });

  it('tolerância zero mantém todos os pontos fora da reta', () => {
    const zigzag = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }, { x: 3, y: 1 }];
    expect(simplifyPath(zigzag, 0)).toHaveLength(4);
  });
});
