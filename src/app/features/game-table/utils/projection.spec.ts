import { IDENTITY, apply, invert, isoMatrix, multiply, project, projectedBounds, unproject, uprightMatrix } from './projection';

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('projeção isométrica', () => {
  const m = isoMatrix(0.5);

  it('gira 45° e achata: o mapa vira um losango', () => {
    const right = apply(m, { x: 100, y: 0 });
    const down = apply(m, { x: 0, y: 100 });
    close(right.x, 70.710678);
    close(right.y, 35.355339);
    close(down.x, -70.710678);
    close(down.y, 35.355339);
  });

  it('tela → mundo desfaz mundo → tela (com zoom e pan)', () => {
    const view = { x: 40, y: -20, scale: 1.7 };
    const p = { x: 123, y: 456 };
    const s = project(view, m, p);
    const back = unproject(view, m, s.x, s.y);
    close(back.x, p.x);
    close(back.y, p.y);
  });

  it('2D = identidade (mesmo comportamento de antes)', () => {
    const view = { x: 10, y: 5, scale: 2 };
    expect(project(view, IDENTITY, { x: 3, y: 4 })).toEqual({ x: 16, y: 13 });
    expect(uprightMatrix(IDENTITY)).toBeNull();
  });

  it('caixa do mapa projetado', () => {
    const b = projectedBounds(m, 100, 100);
    close(b.width, 141.421356);
    close(b.height, 70.710678);
    close(b.x, -70.710678);
  });

  it('elemento "em pé": M × upright = só o achatamento leve', () => {
    const up = uprightMatrix(m, 0.8)!;
    const r = multiply(m, up);
    close(r[0], 1);
    close(r[1], 0);
    close(r[2], 0);
    close(r[3], 0.8);
    const id = multiply(m, invert(m));
    close(id[0], 1);
    close(id[3], 1);
  });
});
