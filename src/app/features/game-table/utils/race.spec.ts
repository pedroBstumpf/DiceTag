import { CharacterSheet, TokenBar, withStatusBars } from '../../../core/models/table-session.model';
import { raceTraitsOf } from '../../../core/models/world-item.model';
import { RaceChoice, applyRace, raceKey } from './race';

const elfo: RaceChoice = {
  ref: { id: 'elfo', global: true },
  name: 'Elfo',
  traits: ['Longevo', 'Visão no escuro', ' '],
  statusMods: { 'status-mind': 2, 'status-body': -1 },
};
const anao: RaceChoice = { ref: { id: 'anao' }, name: 'Anão', traits: ['Teimoso'], statusMods: { 'status-body': 3 } };

/** Barras de status cheias (24/24) + uma barra comum. */
function bars(): TokenBar[] {
  return [...withStatusBars([]), { id: 'mana', label: 'Mana', value: 5, max: 10, color: '#00f' }];
}
const byId = (list: TokenBar[], id: string) => list.find((b) => b.id === id)!;

describe('raça na ficha', () => {
  it('aplica as características como rótulos (sem vazios nem repetidos) e soma os modificadores ao máximo', () => {
    const r = applyRace({ labels: ['Nobre', 'Longevo'] }, bars(), 'race', elfo);
    expect(r.sheet).toMatchObject({ race: 'Elfo', raceRef: { id: 'elfo', global: true } });
    expect(r.sheet.labels).toEqual(['Nobre', 'Longevo', 'Visão no escuro']);
    // "Longevo" já existia: não foi a raça que pôs (não sai ao trocar)
    expect(r.sheet.appliedRaces?.race).toEqual({ labels: ['Visão no escuro'], mods: elfo.statusMods });
    expect(byId(r.bars, 'status-mind')).toMatchObject({ max: 26, value: 26 });
    expect(byId(r.bars, 'status-body')).toMatchObject({ max: 23, value: 23 });
    expect(byId(r.bars, 'status-spirit')).toMatchObject({ max: 24, value: 24 });
    expect(byId(r.bars, 'mana')).toMatchObject({ max: 10, value: 5 });
  });

  it('trocar de raça desfaz a anterior; rótulos digitados à mão ficam', () => {
    const first = applyRace({ labels: ['Nobre'] }, bars(), 'race', elfo);
    const sheet = first.sheet as CharacterSheet;
    const second = applyRace(sheet, first.bars, 'race', anao);
    expect(second.sheet.labels).toEqual(['Nobre', 'Teimoso']);
    expect(byId(second.bars, 'status-mind').max).toBe(24);
    expect(byId(second.bars, 'status-body').max).toBe(27);
    expect(second.sheet.race).toBe('Anão');
  });

  it('limpar a raça volta tudo ao que era', () => {
    const first = applyRace({ labels: ['Nobre'] }, bars(), 'race', elfo);
    const cleared = applyRace(first.sheet as CharacterSheet, first.bars, 'race', null);
    expect(cleared.sheet).toMatchObject({ race: '', raceRef: undefined, labels: ['Nobre'], appliedRaces: {} });
    expect(cleared.bars).toEqual(bars());
  });

  it('raça e sub-raça somam e cada uma desfaz só o que aplicou', () => {
    const r1 = applyRace({ labels: [] }, bars(), 'race', anao);
    const r2 = applyRace(r1.sheet as CharacterSheet, r1.bars, 'subrace', elfo);
    expect(r2.sheet.subrace).toBe('Elfo');
    expect(byId(r2.bars, 'status-body').max).toBe(24 + 3 - 1);
    const r3 = applyRace(r2.sheet as CharacterSheet, r2.bars, 'subrace', null);
    expect(r3.sheet.labels).toEqual(['Teimoso']);
    expect(byId(r3.bars, 'status-body').max).toBe(27);
    expect(r3.sheet.appliedRaces?.race).toBeDefined();
  });

  it('valor ferido acompanha a mudança do máximo, sem passar de 0 a máximo; máximo nunca abaixo de 1', () => {
    const hurt = bars().map((b) => (b.id === 'status-body' ? { ...b, value: 2 } : b));
    const r = applyRace({ labels: [] }, hurt, 'race', { ...anao, statusMods: { 'status-body': -30 } });
    expect(byId(r.bars, 'status-body')).toMatchObject({ max: 1, value: 0 });
  });

  it('características: raças antigas com etiquetas (cor e nível) valem só pelo texto', () => {
    const base = { id: 'r', type: 'race' as const, name: 'R', parentId: null, createdAt: 0, updatedAt: 0 };
    expect(raceTraitsOf({ ...base, traits: ['Longevo'] })).toEqual(['Longevo']);
    expect(raceTraitsOf({ ...base, tags: [{ id: 't', text: ' Aprendiz ', color: '#f80', level: 3 }, { id: 'v', text: ' ', color: '#fff' }] })).toEqual([
      'Aprendiz',
    ]);
    expect(raceTraitsOf(base)).toEqual([]);
  });

  it('raceKey separa Lore geral e Worldbuild', () => {
    expect(raceKey({ id: 'x', global: true })).toBe('g:x');
    expect(raceKey({ id: 'x' })).toBe('w:x');
    expect(raceKey(undefined)).toBe('');
  });
});
