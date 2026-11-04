import { trackOffset } from './sound';

describe('trackOffset', () => {
  it('quem acabou de receber o comando começa do início', () => {
    expect(trackOffset(100, 60, true)).toBe(0);
  });

  it('relógio atrasado (tempo negativo) não vira ponto negativo', () => {
    expect(trackOffset(-5000, 60, true)).toBe(0);
  });

  it('com repetição, dá a volta na faixa', () => {
    expect(trackOffset(70_000, 60, true)).toBe(10);
  });

  it('sem repetição: entra no ponto certo e, se já acabou, não toca', () => {
    expect(trackOffset(10_000, 60, false)).toBe(10);
    expect(trackOffset(60_000, 60, false)).toBeNull();
  });

  it('duração desconhecida começa do início', () => {
    expect(trackOffset(10_000, Number.NaN, false)).toBe(0);
    expect(trackOffset(10_000, Number.POSITIVE_INFINITY, true)).toBe(0);
    expect(trackOffset(10_000, 0, true)).toBe(0);
  });
});
