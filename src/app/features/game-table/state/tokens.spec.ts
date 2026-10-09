import { Scene, TableEntry, TableState, TokenSettings, defaultToken } from '../../../core/models/table-session.model';
import { addEntry, removeEntry, setSoundMaster, updateEntry } from './entries';
import { findPlacement } from './helpers';
import { moveToken, placeToken, removeToken, resolveToken, splitTokenPatch, toggleTokenPublic, updatePlacement } from './tokens';

const entry = (id: string, kind: TableEntry['kind'], extra: Partial<TableEntry> = {}): TableEntry => ({
  id,
  kind,
  name: id,
  createdAt: 0,
  ...extra,
});
const scene = (id: string, extra: Partial<Scene> = {}): Scene => ({ id, name: id, gridSize: 70, showGrid: true, tokens: [], ...extra });

function table(): TableState {
  return {
    scenes: [
      scene('a', { tokens: [{ id: 't1', entryId: 'pc', x: 0, y: 0 }] }),
      scene('b', { tokens: [{ id: 't2', entryId: 'npc', x: 10, y: 10, size: 2 }] }),
    ],
    activeSceneId: 'a',
    entries: [entry('pc', 'character'), entry('npc', 'npc'), entry('act', 'automation', { ownerEntryId: 'npc' })],
  };
}

describe('regra de vínculo dos tokens', () => {
  const settings: TokenSettings = { ...defaultToken('npc'), size: 1, blobId: 'img', speed: 3 };

  it('personagem usa sempre a ficha', () => {
    const t = resolveToken({ id: 't', entryId: 'pc', x: 0, y: 0, size: 4 }, entry('pc', 'character'), settings);
    expect(t.linked).toBe(true);
    expect(t.size).toBe(1);
  });

  it('NPC usa os valores do próprio token; imagem, visão e velocidade vêm da ficha', () => {
    const t = resolveToken({ id: 't', entryId: 'n', x: 0, y: 0, size: 4, name: 'Goblin 2' }, entry('n', 'npc'), settings);
    expect(t.linked).toBe(false);
    expect(t.size).toBe(4);
    expect(t.name).toBe('Goblin 2');
    expect(t.blobId).toBe('img');
    expect(t.speed).toBe(3);
  });

  it('splitTokenPatch: personagem grava tudo na ficha; NPC só visão e velocidade', () => {
    const vision = { enabled: true, range: 9 };
    expect(splitTokenPatch('character', { size: 2, vision })).toEqual({ settings: { size: 2, vision }, placement: null });
    expect(splitTokenPatch('npc', { size: 2, vision })).toEqual({ settings: { vision }, placement: { size: 2 } });
    expect(splitTokenPatch('npc', { size: 2 })).toEqual({ settings: null, placement: { size: 2 } });
    expect(splitTokenPatch('npc', { speed: 0 })).toEqual({ settings: { speed: 0 }, placement: null });
  });
});

describe('comandos: tokens', () => {
  it('placeToken acrescenta na cena pedida', () => {
    const s = placeToken(table(), { sceneId: 'b', placement: { id: 't3', entryId: 'pc', x: 1, y: 2 } });
    expect(s.scenes[1].tokens?.map((t) => t.id)).toEqual(['t2', 't3']);
  });

  it('mover um token troca só a cena que o contém', () => {
    const before = table();
    const after = moveToken(before, { placementId: 't2', x: 5, y: 6 });
    expect(findPlacement(after.scenes, 't2')).toMatchObject({ x: 5, y: 6 });
    expect(after.scenes[0]).toBe(before.scenes[0]);
    expect(moveToken(before, { placementId: 'nao-existe', x: 0, y: 0 })).toBe(before);
  });

  it('updatePlacement mescla campos e toggleTokenPublic alterna (desligado = ausente)', () => {
    let s = updatePlacement(table(), { placementId: 't2', patch: { name: 'Chefe' } });
    expect(findPlacement(s.scenes, 't2')?.name).toBe('Chefe');
    s = toggleTokenPublic(s, { placementId: 't2', part: 'inventory' });
    expect(findPlacement(s.scenes, 't2')?.inventoryPublic).toBe(true);
    s = toggleTokenPublic(s, { placementId: 't2', part: 'inventory' });
    expect(findPlacement(s.scenes, 't2')?.inventoryPublic).toBeUndefined();
  });

  it('removeToken tira o token do mapa', () => {
    expect(findPlacement(removeToken(table(), { placementId: 't1' }).scenes, 't1')).toBeUndefined();
  });
});

describe('comandos: arquivos da mesa', () => {
  it('removeEntry apaga a ficha, as ações dela e os tokens dela em todas as cenas', () => {
    const s = removeEntry(table(), { entryId: 'npc' });
    expect(s.entries.map((e) => e.id)).toEqual(['pc']);
    expect(s.scenes[1].tokens).toEqual([]);
    expect(s.scenes[0].tokens?.length).toBe(1);
  });

  it('addEntry, updateEntry e volume mestre limitado a 0–1', () => {
    let s = addEntry(table(), { entry: entry('som', 'sound') });
    s = updateEntry(s, { entryId: 'som', patch: { volume: 0.3 } });
    expect(s.entries.find((e) => e.id === 'som')?.volume).toBe(0.3);
    expect(setSoundMaster(s, { volume: 3 }).soundMaster).toBe(1);
    expect(setSoundMaster(s, { volume: -1 }).soundMaster).toBe(0);
  });
});
