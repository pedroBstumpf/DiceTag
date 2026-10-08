import { DEFAULT_STATUS_MAX, STATUS_BARS, TokenBar, defaultSheet, defaultToken, isStatusBar, withStatusBars } from './table-session.model';

describe('withStatusBars', () => {
  it('cria Corpo, Mente e Espírito quando não há barras', () => {
    const bars = withStatusBars([]);
    expect(bars.map((b) => b.label)).toEqual(['Corpo', 'Mente', 'Espírito']);
    expect(bars.every((b) => b.value === DEFAULT_STATUS_MAX && b.max === DEFAULT_STATUS_MAX)).toBe(true);
  });

  it('mantém valor e máximo salvos, mas fixa rótulo e cor', () => {
    const saved: TokenBar = { id: STATUS_BARS[1].id, label: 'Outro', value: 3, max: 8, color: '#000000' };
    const mind = withStatusBars([saved])[1];
    expect(mind).toEqual({ ...STATUS_BARS[1], value: 3, max: 8 });
  });

  it('deixa as barras extras depois das de status, na ordem', () => {
    const extra: TokenBar = { id: 'pv', label: 'PV', value: 5, max: 5, color: '#ef4444' };
    const bars = withStatusBars([extra, { ...STATUS_BARS[2], value: 1, max: 2 }]);
    expect(bars.map((b) => b.id)).toEqual([...STATUS_BARS.map((s) => s.id), 'pv']);
    expect(isStatusBar(bars[3])).toBe(false);
  });
});

describe('padrões da ficha', () => {
  it('personagem nasce com as barras de status; NPC sem barras', () => {
    expect(defaultToken('character').bars.filter(isStatusBar)).toHaveLength(3);
    expect(defaultToken('npc').bars).toEqual([]);
  });

  it('ficha vazia tem três temas', () => {
    expect(defaultSheet().themes).toHaveLength(3);
  });
});
