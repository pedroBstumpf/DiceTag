import { DroppedItem, Scene, TableState } from '../../../core/models/table-session.model';
import { applyCommand } from './commands';
import { findDrop } from './drops';
import { removeLevel } from './levels';
import { canManageDrops } from './permissions';
import { FogView, visibleDropsFor } from './player-view';

const drop = (id: string, x: number, level?: number): DroppedItem => ({ id, x, y: 50, ...(level && { level }), item: { id: `i-${id}`, itemId: 'espada' } });
const scene = (id: string, drops: DroppedItem[] = []): Scene => ({ id, name: id, gridSize: 70, showGrid: true, drops });
const state = (...scenes: Scene[]): TableState => ({ scenes, activeSceneId: scenes[0]?.id ?? null, entries: [] });

describe('itens largados no mapa', () => {
  it('larga, move e tira um item, mudando só a cena dele', () => {
    const other = scene('b');
    let s = applyCommand(state(scene('a'), other), { type: 'addDrop', payload: { sceneId: 'a', drop: drop('d', 10) } });
    expect(findDrop(s.scenes, 'd')?.scene.id).toBe('a');

    s = applyCommand(s, { type: 'moveDrop', payload: { dropId: 'd', x: 200, y: 300 } });
    expect(findDrop(s.scenes, 'd')?.drop).toMatchObject({ x: 200, y: 300 });
    expect(s.scenes[1]).toBe(other);

    s = applyCommand(s, { type: 'removeDrop', payload: { dropId: 'd' } });
    expect(findDrop(s.scenes, 'd')).toBeUndefined();
  });

  it('item inexistente devolve o mesmo estado', () => {
    const s = state(scene('a'));
    expect(applyCommand(s, { type: 'removeDrop', payload: { dropId: 'x' } })).toBe(s);
    expect(applyCommand(s, { type: 'moveDrop', payload: { dropId: 'x', x: 0, y: 0 } })).toBe(s);
  });

  it('quantidade da pilha: mínimo 1, e 1 não fica gravado', () => {
    let s = state(scene('a', [drop('d', 10)]));
    s = applyCommand(s, { type: 'setDropQuantity', payload: { dropId: 'd', quantity: 4.4 } });
    expect(findDrop(s.scenes, 'd')?.drop.item.quantity).toBe(4);
    s = applyCommand(s, { type: 'setDropQuantity', payload: { dropId: 'd', quantity: 0 } });
    expect(findDrop(s.scenes, 'd')?.drop.item.quantity).toBeUndefined();
  });

  it('excluir uma camada desce os itens dela e os de cima', () => {
    const s = state({ ...scene('a', [drop('chao', 0), drop('meio', 0, 1), drop('alto', 0, 2)]), levels: [{ id: 'l1', name: '1' }, { id: 'l2', name: '2' }] });
    const drops = removeLevel(s, { sceneId: 'a', index: 1 }).scenes[0].drops ?? [];
    expect(drops.map((d) => d.level ?? 0)).toEqual([0, 0, 1]);
  });

  it('o jogador só vê os itens que algum token enxerga; o mestre vê todos', () => {
    const fog: FogView = { enabled: true, polygons: [[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]], explored: null };
    const drops = [drop('perto', 50), drop('longe', 500)];
    expect(visibleDropsFor(drops, 'player', fog).map((d) => d.id)).toEqual(['perto']);
    expect(visibleDropsFor(drops, 'gm', fog)).toBe(drops);
    expect(visibleDropsFor(drops, 'player', { ...fog, enabled: false })).toBe(drops);
  });

  it('só o mestre move, muda a quantidade e tira itens do mapa', () => {
    expect(canManageDrops({ role: 'gm', userId: 'u' })).toBe(true);
    expect(canManageDrops({ role: 'player', userId: 'u' })).toBe(false);
  });
});
