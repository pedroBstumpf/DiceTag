import { distanceToPolyline, distanceToSegment, sizeFromHandle, snapToCorner, snapTokenCenter } from './geometry';

describe('geometry', () => {
  describe('snapTokenCenter', () => {
    it('token de 1 quadrado vai para o centro do quadrado', () => {
      expect(snapTokenCenter({ x: 75, y: 130 }, 1, 70)).toEqual({ x: 105, y: 105 });
    });

    it('token de 2 quadrados vai para o cruzamento das linhas', () => {
      expect(snapTokenCenter({ x: 75, y: 130 }, 2, 70)).toEqual({ x: 70, y: 140 });
    });

    it('token de meio quadrado e de 3 quadrados ficam no centro', () => {
      expect(snapTokenCenter({ x: 10, y: 10 }, 0.5, 70)).toEqual({ x: 35, y: 35 });
      expect(snapTokenCenter({ x: 10, y: 10 }, 3, 70)).toEqual({ x: 35, y: 35 });
    });
  });

  it('snapToCorner arredonda para o canto mais próximo', () => {
    expect(snapToCorner({ x: 34, y: 36 }, 70)).toEqual({ x: 0, y: 70 });
  });

  describe('sizeFromHandle', () => {
    it('usa passos de meio quadrado', () => {
      // meia largura de 52,5px = 1,5 quadrado de 70px
      expect(sizeFromHandle({ x: 0, y: 0 }, { x: 52.5, y: 10 }, 70)).toBe(1.5);
    });

    it('respeita os limites de tamanho', () => {
      expect(sizeFromHandle({ x: 0, y: 0 }, { x: 1, y: 1 }, 70)).toBe(0.5);
      expect(sizeFromHandle({ x: 0, y: 0 }, { x: 5000, y: 0 }, 70)).toBe(4);
    });
  });

  it('distanceToSegment mede até o ponto mais próximo do segmento', () => {
    expect(distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
    expect(distanceToSegment({ x: 14, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
  });

  it('distanceToPolyline considera todos os segmentos', () => {
    const line = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    expect(distanceToPolyline({ x: 12, y: 5 }, line)).toBe(2);
    expect(distanceToPolyline({ x: 0, y: 0 }, [])).toBe(Number.POSITIVE_INFINITY);
  });
});
