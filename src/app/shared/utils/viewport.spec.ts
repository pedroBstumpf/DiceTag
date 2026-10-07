import { fitRect, screenToWorld, worldToScreen, zoomAt } from './viewport';

describe('viewport', () => {
  it('zoomAt mantém fixo o ponto sob o cursor', () => {
    const view = { x: 10, y: 20, scale: 1 };
    const before = screenToWorld(view, 200, 100);
    const after = screenToWorld(zoomAt(view, 2, 200, 100, 0.1, 10), 200, 100);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('zoomAt respeita os limites de escala', () => {
    expect(zoomAt({ x: 0, y: 0, scale: 1 }, 100, 0, 0, 0.1, 6).scale).toBe(6);
    expect(zoomAt({ x: 0, y: 0, scale: 1 }, 0.001, 0, 0, 0.1, 6).scale).toBe(0.1);
  });

  it('screenToWorld e worldToScreen são inversas', () => {
    const view = { x: -35, y: 12, scale: 2.5 };
    const p = worldToScreen(view, screenToWorld(view, 123, 456));
    expect(p.x).toBeCloseTo(123);
    expect(p.y).toBeCloseTo(456);
  });

  it('fitRect centraliza o conteúdo na área', () => {
    const view = fitRect({ x: 100, y: 100, width: 200, height: 100 }, { x: 0, y: 0, width: 400, height: 400 }, 1);
    expect(view.scale).toBe(2);
    // O centro do conteúdo (200, 150) vai para o centro da área (200, 200)
    const center = worldToScreen(view, { x: 200, y: 150 });
    expect(center.x).toBeCloseTo(200);
    expect(center.y).toBeCloseTo(200);
  });

  it('fitRect limita a escala máxima', () => {
    expect(fitRect({ x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 1000, height: 1000 }, 1, 1.5).scale).toBe(1.5);
  });
});
