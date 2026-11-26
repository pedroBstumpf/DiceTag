import { Scene, TableEntry, TableState, normalizeSheet } from '../../../core/models/table-session.model';
import { findPlacement } from './helpers';
import { applySheetPatch, patchSheet, sheetPatchOf } from './sheets';

const entry = (id: string, kind: TableEntry['kind'], extra: Partial<TableEntry> = {}): TableEntry => ({
  id,
  kind,
  name: id,
  createdAt: 0,
  ...extra,
});
const scene = (tokens: Scene['tokens']): Scene => ({ id: 's', name: 's', gridSize: 70, showGrid: true, tokens });
const table = (): TableState => ({
  scenes: [
    scene([
      { id: 't-copia', entryId: 'goblin', x: 0, y: 0, sheet: { ...normalizeSheet(undefined), eiros: 5 } },
      { id: 't-antigo', entryId: 'goblin', x: 0, y: 0 },
    ]),
  ],
  activeSceneId: 's',
  entries: [
    entry('heroi', 'character', { sheet: { ...normalizeSheet(undefined), eiros: 10, labels: ['Nobre'] } }),
    entry('goblin', 'npc'),
    entry('musica', 'sound'),
  ],
});

describe('ficha por campo', () => {
  it('sheetPatchOf troca undefined por null (campo apagado chega ao servidor)', () => {
    expect(sheetPatchOf({ raceRef: undefined, eiros: 3 })).toEqual({ raceRef: null, eiros: 3 });
  });

  it('applySheetPatch troca só os campos enviados e null apaga o campo', () => {
    const sheet = { ...normalizeSheet(undefined), raceRef: { id: 'elfo' }, eiros: 7 };
    const next = applySheetPatch(sheet, { raceRef: null, labels: ['Exilado'] });
    expect(next.raceRef).toBeUndefined();
    expect('raceRef' in next).toBe(false);
    expect(next.labels).toEqual(['Exilado']);
    expect(next.eiros).toBe(7);
  });

  it('duas alterações em campos diferentes não se apagam (o problema da ficha inteira)', () => {
    let s = patchSheet(table(), { sheetId: 'heroi', patch: { eiros: 20 } });
    s = patchSheet(s, { sheetId: 'heroi', patch: { labels: ['Nobre', 'Exilado'] } });
    const sheet = s.entries.find((e) => e.id === 'heroi')?.sheet;
    expect(sheet?.eiros).toBe(20);
    expect(sheet?.labels).toEqual(['Nobre', 'Exilado']);
  });

  it('ficha sem dados salvos recebe os padrões e o patch', () => {
    const s = patchSheet(table(), { sheetId: 'goblin', patch: { eiros: 2 } });
    const sheet = s.entries.find((e) => e.id === 'goblin')?.sheet;
    expect(sheet?.eiros).toBe(2);
    expect(sheet?.themes).toHaveLength(3);
  });

  it('barras vindas do servidor (raça) vão para o token da ficha, com as três de status', () => {
    const s = patchSheet(table(), { sheetId: 'goblin', patch: {}, bars: [] });
    expect(s.entries.find((e) => e.id === 'goblin')?.token?.bars.map((b) => b.id)).toEqual([
      'status-body',
      'status-mind',
      'status-spirit',
    ]);
  });

  it('cópia do token de NPC: altera só a cópia dele', () => {
    const before = table();
    const s = patchSheet(before, { sheetId: 'npc:t-copia', patch: { eiros: 9 } });
    expect(findPlacement(s.scenes, 't-copia')?.sheet?.eiros).toBe(9);
    expect(s.entries).toBe(before.entries);
  });

  it('sem efeito: token sem cópia própria, arquivo sem ficha, ficha inexistente ou patch vazio', () => {
    const s = table();
    expect(patchSheet(s, { sheetId: 'npc:t-antigo', patch: { eiros: 1 } })).toBe(s);
    expect(patchSheet(s, { sheetId: 'musica', patch: { eiros: 1 } })).toBe(s);
    expect(patchSheet(s, { sheetId: 'nada', patch: { eiros: 1 } })).toBe(s);
    expect(patchSheet(s, { sheetId: 'heroi', patch: {} })).toBe(s);
  });
});
