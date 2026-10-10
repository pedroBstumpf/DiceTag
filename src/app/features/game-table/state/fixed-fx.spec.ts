import { FixedFx, Scene, TableState } from '../../../core/models/table-session.model';
import { applyCommand } from './commands';
import { removeLevel } from './levels';
import { canRemoveFixedFx } from './permissions';

const fx = (id: string, level?: number, ownerUserId = 'ana'): FixedFx => ({
  id,
  kind: 'vortex',
  color: '#000000',
  from: { x: 0, y: 0 },
  to: { x: 70, y: 0 },
  seed: 1,
  scale: 1,
  ...(level && { level }),
  ownerUserId,
});
const scene = (effects: FixedFx[] = []): Scene => ({ id: 'a', name: 'a', gridSize: 70, showGrid: true, effects });
const state = (sc: Scene): TableState => ({ scenes: [sc], activeSceneId: sc.id, entries: [] });

describe('efeitos fixos no mapa', () => {
  it('fixa, tira um e tira vários', () => {
    let s = applyCommand(state(scene()), { type: 'addFixedFx', payload: { sceneId: 'a', fx: fx('1') } });
    s = applyCommand(s, { type: 'addFixedFx', payload: { sceneId: 'a', fx: fx('2') } });
    s = applyCommand(s, { type: 'addFixedFx', payload: { sceneId: 'a', fx: fx('3') } });
    s = applyCommand(s, { type: 'removeFixedFx', payload: { sceneId: 'a', fxId: '1' } });
    expect(s.scenes[0].effects?.map((f) => f.id)).toEqual(['2', '3']);
    s = applyCommand(s, { type: 'clearFixedFx', payload: { sceneId: 'a', fxIds: ['3'] } });
    expect(s.scenes[0].effects?.map((f) => f.id)).toEqual(['2']);
    s = applyCommand(s, { type: 'clearFixedFx', payload: { sceneId: 'a' } });
    expect(s.scenes[0].effects).toEqual([]);
  });

  it('excluir uma camada apaga os efeitos dela e desce os de cima', () => {
    const s = state({ ...scene([fx('chao'), fx('meio', 1), fx('alto', 2)]), levels: [{ id: 'l1', name: '1' }, { id: 'l2', name: '2' }] });
    const effects = removeLevel(s, { sceneId: 'a', index: 1 }).scenes[0].effects ?? [];
    expect(effects.map((f) => [f.id, f.level ?? 0])).toEqual([['chao', 0], ['alto', 1]]);
  });

  it('quem lançou e o mestre removem', () => {
    expect(canRemoveFixedFx(fx('1'), { role: 'player', userId: 'ana' })).toBe(true);
    expect(canRemoveFixedFx(fx('1'), { role: 'player', userId: 'bia' })).toBe(false);
    expect(canRemoveFixedFx(fx('1'), { role: 'gm', userId: 'bia' })).toBe(true);
  });
});
