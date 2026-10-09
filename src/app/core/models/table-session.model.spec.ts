import {
  DEFAULT_STATUS_MAX,
  STATUS_BARS,
  TokenBar,
  defaultSheet,
  defaultToken,
  isDown,
  isStatusBar,
  normalizeSheet,
  withFixedNotePages,
  withStatusBars,
} from './table-session.model';

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

describe('isDown', () => {
  it('só barras de status zeradas contam', () => {
    const bars = withStatusBars([]);
    expect(isDown(bars)).toBe(false);
    expect(isDown(bars.map((b, i) => (i === 1 ? { ...b, value: 0 } : b)))).toBe(true);
    expect(isDown([...bars, { id: 'pv', label: 'PV', value: 0, max: 5, color: '#fff' }])).toBe(false);
  });
});

describe('padrões da ficha', () => {
  it('personagem e NPC nascem com as barras de status; outros tipos sem barras', () => {
    expect(defaultToken('character').bars.filter(isStatusBar)).toHaveLength(3);
    expect(defaultToken('npc').bars.filter(isStatusBar)).toHaveLength(3);
    expect(defaultToken('automation').bars).toEqual([]);
  });

  it('ficha vazia tem três temas', () => {
    expect(defaultSheet().themes).toHaveLength(3);
  });

  it('fichas antigas ganham objetivo nos temas e os três estudos', () => {
    const old = normalizeSheet({ themes: [{ id: 'theme-1', name: 'Espada', tags: [], flaws: [] } as never] });
    expect(old.themes[0]).toMatchObject({ name: 'Espada', goal: '', goalProgress: 0 });
    expect(old.studies.map((s) => s.id)).toEqual(['study-1', 'study-2', 'study-3']);
    const kept = normalizeSheet({ studies: [{ id: 'study-1', text: 'Alquimia', sa: 2, sn: 5 }] });
    expect(kept.studies[0]).toEqual({ id: 'study-1', text: 'Alquimia', sa: 2, sn: 5 });
    expect(kept.studies).toHaveLength(3);
  });
});

describe('páginas fixas das anotações', () => {
  it('ficha nova começa com Background e Jornal', () => {
    expect(defaultSheet().notes.map((p) => p.title)).toEqual(['Background', 'Jornal']);
  });

  it('mantém o texto das fixas, fixa o título e deixa as do jogador depois, na ordem', () => {
    const notes = withFixedNotePages([
      { id: 'b', title: 'Viagem', content: '<p>2</p>' },
      { id: 'journal', title: 'Outro nome', content: '<p>dia 1</p>' },
      { id: 'a', title: 'Mapa', content: '' },
    ]);
    expect(notes.map((p) => p.id)).toEqual(['background', 'journal', 'b', 'a']);
    expect(notes[1]).toEqual({ id: 'journal', title: 'Jornal', content: '<p>dia 1</p>' });
  });

  it('descarta a antiga página padrão vazia, mas não a que tem texto', () => {
    expect(normalizeSheet({ notes: [{ id: 'page-1', title: 'Página 1', content: '<p></p>' }] }).notes).toHaveLength(2);
    expect(normalizeSheet({ notes: [{ id: 'page-1', title: 'Página 1', content: '<p>oi</p>' }] }).notes).toHaveLength(3);
  });
});
