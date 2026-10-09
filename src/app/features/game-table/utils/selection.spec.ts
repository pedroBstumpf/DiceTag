import {
  NO_SELECTION,
  keepOnly,
  pointInRect,
  rectFromCorners,
  selectMany,
  selectOne,
  shiftGroup,
  toggleInSelection,
  without,
} from './selection';

const ids = (sel: { ids: ReadonlySet<string> }) => [...sel.ids].sort();

describe('seleção de tokens', () => {
  it('selectOne seleciona só um (null limpa)', () => {
    expect(selectOne('a')).toEqual({ ids: new Set(['a']), primary: 'a' });
    expect(selectOne(null)).toBe(NO_SELECTION);
  });

  it('Shift+clique: entra como principal; clicar de novo tira e o principal passa a outro', () => {
    let sel = toggleInSelection(selectOne('a'), 'b');
    expect(ids(sel)).toEqual(['a', 'b']);
    expect(sel.primary).toBe('b');
    sel = toggleInSelection(sel, 'b');
    expect(sel).toEqual({ ids: new Set(['a']), primary: 'a' });
    expect(toggleInSelection(sel, 'a')).toBe(NO_SELECTION);
  });

  it('caixa de seleção substitui ou, com Shift, soma; o principal fica se continuar selecionado', () => {
    const base = toggleInSelection(selectOne('a'), 'b');
    expect(selectMany(base, ['c', 'd'], false)).toEqual({ ids: new Set(['c', 'd']), primary: 'c' });
    const added = selectMany(base, ['c'], true);
    expect(ids(added)).toEqual(['a', 'b', 'c']);
    expect(added.primary).toBe('b');
    expect(selectMany(base, [], false)).toBe(NO_SELECTION);
    expect(selectMany(base, [], true)).toEqual(base);
  });

  it('without / keepOnly tiram tokens e mantêm o principal válido', () => {
    const sel = selectMany(NO_SELECTION, ['a', 'b', 'c'], false);
    expect(without(sel, ['x'])).toBe(sel);
    const rest = without(sel, ['a']);
    expect(ids(rest)).toEqual(['b', 'c']);
    expect(rest.primary === 'b' || rest.primary === 'c').toBe(true);
    expect(keepOnly(sel, (id) => id === 'c')).toEqual({ ids: new Set(['c']), primary: 'c' });
  });

  it('retângulo em qualquer direção e ponto dentro dele (bordas contam)', () => {
    const r = rectFromCorners({ x: 10, y: 50 }, { x: 0, y: 0 });
    expect(r).toEqual({ x: 0, y: 0, width: 10, height: 50 });
    expect(pointInRect({ x: 10, y: 50 }, r)).toBe(true);
    expect(pointInRect({ x: 11, y: 5 }, r)).toBe(false);
  });

  it('shiftGroup mantém a formação', () => {
    expect(shiftGroup([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 70, y: 140 }], { x: 7, y: -3 })).toEqual([
      { placementId: 'a', x: 7, y: -3 },
      { placementId: 'b', x: 77, y: 137 },
    ]);
  });
});
