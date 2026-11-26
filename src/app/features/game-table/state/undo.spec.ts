import { FixedFx, Scene, TableState, normalizeSheet } from '../../../core/models/table-session.model';
import { TableCommand, applyCommand } from './commands';
import { findDrop } from './drops';
import { findPlacement } from './helpers';
import { EMPTY_UNDO, UNDO_LIMIT, UNDO_MERGE_MS, UndoStacks, extendLastUndo, inverseOf, inverseOfAll, recordUndo, undoKey } from './undo';

const scene = (extra: Partial<Scene> = {}): Scene => ({ id: 's', name: 's', gridSize: 70, showGrid: true, ...extra });
const table = (sc: Scene = scene()): TableState => ({
  scenes: [sc],
  activeSceneId: sc.id,
  entries: [{ id: 'pc', kind: 'character', name: 'Ana', createdAt: 0, token: { size: 1, vision: { enabled: true, range: 18 }, bars: [], tags: [] } }],
});
const withToken = () => table(scene({ tokens: [{ id: 't', entryId: 'pc', x: 10, y: 20 }] }));

/** Aplica o comando, depois o que o desfaz: tem de voltar ao estado de antes. */
function roundTrip(state: TableState, command: TableCommand): TableState {
  const inverse = inverseOf(state, command);
  expect(inverse).not.toBeNull();
  return inverse!.reduce(applyCommand, applyCommand(state, command));
}

describe('desfazer: o comando que volta atrás', () => {
  it('tokens: colocar, mover, mover vários, tirar, alterar', () => {
    const base = withToken();
    const empty = table(scene({ tokens: [] }));
    expect(roundTrip(empty, { type: 'placeToken', payload: { sceneId: 's', placement: { id: 't', entryId: 'pc', x: 1, y: 1 } } })).toEqual(empty);
    expect(roundTrip(base, { type: 'moveToken', payload: { placementId: 't', x: 99, y: 99 } })).toEqual(base);
    expect(roundTrip(base, { type: 'moveTokens', payload: { moves: [{ placementId: 't', x: 5, y: 5 }] } })).toEqual(base);
    expect(roundTrip(base, { type: 'removeToken', payload: { placementId: 't' } })).toEqual(base);
    const sized = applyCommand(base, { type: 'updatePlacement', payload: { placementId: 't', patch: { size: 2 } } });
    expect(roundTrip(sized, { type: 'updatePlacement', payload: { placementId: 't', patch: { size: 4 } } })).toEqual(sized);
  });

  it('o token da ficha (tamanho do personagem) volta inteiro', () => {
    const base = withToken();
    const token = { ...base.entries[0].token!, size: 3 };
    expect(roundTrip(base, { type: 'updateEntry', payload: { entryId: 'pc', patch: { token } } })).toEqual(base);
    // O resto da ficha não é desfeito pelo Ctrl+Z do mapa
    expect(inverseOf(base, { type: 'updateEntry', payload: { entryId: 'pc', patch: { name: 'Bia' } } })).toBeNull();
  });

  it('paredes, portas, desenhos, anotações, itens no chão e efeitos fixos', () => {
    const door = { id: 'd', kind: 'door' as const, points: [], open: false };
    const stroke = { id: 'st', points: [], color: '#fff', width: 4, opacity: 1 };
    const note = { id: 'n', x: 0, y: 0, title: 'Placa', text: '', color: '#fff', gmOnly: false };
    const drop = { id: 'dr', x: 0, y: 0, item: { id: 'i', itemId: 'espada' } };
    const fx: FixedFx = { id: 'fx', kind: 'explosion', color: '#f00', from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, seed: 1, scale: 1, ownerUserId: 'u' };
    const base = table(scene({ walls: [door], drawings: [stroke], notes: [note], drops: [drop], effects: [fx] }));
    const cases: TableCommand[] = [
      { type: 'addWall', payload: { sceneId: 's', wall: { id: 'w', kind: 'line', points: [] } } },
      { type: 'removeWall', payload: { sceneId: 's', wallId: 'd' } },
      { type: 'updateWall', payload: { sceneId: 's', wall: { ...door, points: [{ x: 1, y: 1 }] } } },
      { type: 'setDoorOpen', payload: { sceneId: 's', doorId: 'd', open: true } },
      { type: 'addStroke', payload: { sceneId: 's', stroke: { ...stroke, id: 'st2' } } },
      { type: 'eraseStrokes', payload: { sceneId: 's', strokeIds: ['st'] } },
      { type: 'addNote', payload: { sceneId: 's', note: { ...note, id: 'n2' } } },
      { type: 'removeNote', payload: { sceneId: 's', noteId: 'n' } },
      { type: 'updateNote', payload: { sceneId: 's', noteId: 'n', patch: { title: 'Outra', x: 50 } } },
      { type: 'addDrop', payload: { sceneId: 's', drop: { ...drop, id: 'dr2' } } },
      { type: 'removeDrop', payload: { dropId: 'dr' } },
      { type: 'moveDrop', payload: { dropId: 'dr', x: 70, y: 70 } },
      { type: 'setDropQuantity', payload: { dropId: 'dr', quantity: 5 } },
      { type: 'addFixedFx', payload: { sceneId: 's', fx: { ...fx, id: 'fx2' } } },
      { type: 'removeFixedFx', payload: { sceneId: 's', fxId: 'fx' } },
      { type: 'clearFixedFx', payload: { sceneId: 's' } },
    ];
    for (const command of cases) expect(roundTrip(base, command), command.type).toEqual(base);
  });

  it('não desfaz o que apaga imagens, o que não mudaria nada nem o que não é do mapa', () => {
    const withImages = table(
      scene({
        tokens: [{ id: 't', entryId: 'pc', x: 0, y: 0, sheet: { ...normalizeSheet(undefined), inventory: [{ id: 'l', itemId: 'x', blobId: 'img' }] } }],
        drops: [{ id: 'dr', x: 0, y: 0, item: { id: 'i', itemId: 'x', blobId: 'img' } }],
      }),
    );
    expect(inverseOf(withImages, { type: 'removeToken', payload: { placementId: 't' } })).toBeNull();
    expect(inverseOf(withImages, { type: 'removeDrop', payload: { dropId: 'dr' } })).toBeNull();
    expect(inverseOf(withToken(), { type: 'moveToken', payload: { placementId: 't', x: 10, y: 20 } })).toBeNull();
    expect(inverseOf(withToken(), { type: 'addChatMessage', payload: { message: { id: 'm', at: 0, userId: 'u', author: 'A', role: 'gm', text: 'oi' } } })).toBeNull();
    // Campo que não existia antes não tem como voltar (some no envio): fica de fora
    expect(inverseOf(withToken(), { type: 'updatePlacement', payload: { placementId: 't', patch: { size: 2 } } })).toBeNull();
  });

  it('inverseOfAll desfaz uma sequência do último para o primeiro', () => {
    const base = withToken();
    const commands: TableCommand[] = [
      { type: 'moveToken', payload: { placementId: 't', x: 1, y: 1 } },
      { type: 'moveToken', payload: { placementId: 't', x: 2, y: 2 } },
      { type: 'removeToken', payload: { placementId: 't' } },
    ];
    const after = commands.reduce(applyCommand, base);
    expect(inverseOfAll(base, commands).reduce(applyCommand, after)).toEqual(base);
    expect(findPlacement(after.scenes, 't')).toBeUndefined();
    expect(findDrop(after.scenes, 'nada')).toBeUndefined();
  });
});

describe('desfazer: pilhas', () => {
  const entry = (key: string | null, at: number) => ({ commands: [], key, at });

  it('o mesmo gesto (mesma chave, pouco depois) vira um passo só, com o estado do começo', () => {
    const move = (x: number): TableCommand => ({ type: 'moveToken', payload: { placementId: 't', x, y: 0 } });
    expect(undoKey(move(1))).toBe(undoKey(move(2)));
    let s = recordUndo(EMPTY_UNDO, { ...entry(undoKey(move(1)), 0), commands: [move(0)] });
    s = recordUndo(s, { ...entry(undoKey(move(2)), 100), commands: [move(1)] });
    expect(s.done).toHaveLength(1);
    expect(s.done[0].commands).toEqual([move(0)]);
    // Depois de uma pausa é outro passo
    s = recordUndo(s, { ...entry(undoKey(move(3)), 100 + UNDO_MERGE_MS + 1), commands: [move(2)] });
    expect(s.done).toHaveLength(2);
  });

  it('ação nova apaga o refazer; o limite tira os mais antigos', () => {
    let s: UndoStacks = { done: [], undone: [entry(null, 0)] };
    s = recordUndo(s, entry(null, 1));
    expect(s.undone).toEqual([]);
    for (let i = 0; i < UNDO_LIMIT + 5; i++) s = recordUndo(s, entry(null, i * 10_000));
    expect(s.done).toHaveLength(UNDO_LIMIT);
  });

  it('extendLastUndo junta ao passo mais recente, aplicando o mais novo primeiro', () => {
    const a: TableCommand = { type: 'removeToken', payload: { placementId: 'a' } };
    const b: TableCommand = { type: 'removeToken', payload: { placementId: 'b' } };
    const s = extendLastUndo(recordUndo(EMPTY_UNDO, { commands: [a], key: 'k', at: 0 }), [b]);
    expect(s.done[0]).toMatchObject({ commands: [b, a], key: null });
    expect(extendLastUndo(EMPTY_UNDO, [b])).toBe(EMPTY_UNDO);
  });
});
