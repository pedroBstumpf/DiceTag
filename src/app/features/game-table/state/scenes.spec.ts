import { Scene, TableState } from '../../../core/models/table-session.model';
import { addLevel, clampLevelIn, removeLevel, renameLevel, setLevelImage, setPlayerLevel } from './levels';
import {
  addScene,
  addSceneFolder,
  moveSceneToFolder,
  removeScene,
  removeSceneFolder,
  renameSceneFolder,
  updateScene,
} from './scenes';

const scene = (id: string, extra: Partial<Scene> = {}): Scene => ({ id, name: id, gridSize: 70, showGrid: true, ...extra });
const table = (...scenes: Scene[]): TableState => ({ scenes, activeSceneId: scenes[0]?.id ?? null, entries: [] });

describe('comandos: cenas', () => {
  it('addScene acrescenta e torna ativa', () => {
    const s = addScene(table(scene('a')), { scene: scene('b') });
    expect(s.scenes.map((sc) => sc.id)).toEqual(['a', 'b']);
    expect(s.activeSceneId).toBe('b');
  });

  it('updateScene muda só a cena pedida (as outras mantêm a referência)', () => {
    const before = table(scene('a'), scene('b'));
    const after = updateScene(before, { sceneId: 'b', patch: { name: 'Taverna' } });
    expect(after.scenes[1].name).toBe('Taverna');
    expect(after.scenes[0]).toBe(before.scenes[0]);
  });

  it('cena inexistente não altera o estado', () => {
    const before = table(scene('a'));
    expect(updateScene(before, { sceneId: 'x', patch: { name: 'n' } })).toBe(before);
  });

  it('removeScene da cena ativa ativa a primeira restante', () => {
    const s = removeScene(table(scene('a'), scene('b')), { sceneId: 'a' });
    expect(s.activeSceneId).toBe('b');
    expect(removeScene(s, { sceneId: 'b' }).activeSceneId).toBeNull();
  });

  it('pastas: renomear ignora vazio; excluir tira as cenas da pasta', () => {
    let s = addSceneFolder(table(scene('a')), { folder: { id: 'f', name: 'Nova pasta' } });
    s = moveSceneToFolder(s, { sceneId: 'a', folderId: 'f' });
    expect(s.scenes[0].folderId).toBe('f');
    expect(renameSceneFolder(s, { folderId: 'f', name: '   ' })).toBe(s);
    expect(renameSceneFolder(s, { folderId: 'f', name: ' Cidade ' }).sceneFolders?.[0].name).toBe('Cidade');
    s = removeSceneFolder(s, { folderId: 'f' });
    expect(s.sceneFolders).toEqual([]);
    expect(s.scenes[0].folderId).toBeUndefined();
  });
});

describe('comandos: camadas do mapa', () => {
  it('addLevel respeita o máximo de camadas', () => {
    let s = table(scene('a'));
    for (let i = 0; i < 10; i++) s = addLevel(s, { sceneId: 'a', level: { id: `l${i}`, name: `Camada ${i}` } });
    // Térreo + 4
    expect(s.scenes[0].levels?.length).toBe(4);
  });

  it('renameLevel e setLevelImage não mexem no térreo', () => {
    const s = table(scene('a', { levels: [{ id: 'l1', name: 'Céu', blobId: 'b1' }] }));
    expect(renameLevel(s, { sceneId: 'a', index: 0, name: 'x' })).toBe(s);
    expect(renameLevel(s, { sceneId: 'a', index: 1, name: 'Torre' }).scenes[0].levels?.[0].name).toBe('Torre');
    expect(setLevelImage(s, { sceneId: 'a', index: 1 }).scenes[0].levels?.[0].blobId).toBeUndefined();
  });

  it('removeLevel desce tokens e paredes de cima, apaga as paredes da camada e ajusta a dos jogadores', () => {
    const s = removeLevel(
      table(
        scene('a', {
          levels: [{ id: 'l1', name: '1' }, { id: 'l2', name: '2' }],
          tokens: [
            { id: 't0', entryId: 'e', x: 0, y: 0 },
            { id: 't1', entryId: 'e', x: 0, y: 0, level: 1 },
            { id: 't2', entryId: 'e', x: 0, y: 0, level: 2 },
          ],
          walls: [
            { id: 'w1', kind: 'line', points: [], level: 1 },
            { id: 'w2', kind: 'line', points: [], level: 2 },
          ],
          playerLevel: 2,
        }),
      ),
      { sceneId: 'a', index: 1 },
    ).scenes[0];
    expect(s.levels?.map((l) => l.id)).toEqual(['l2']);
    expect(s.tokens?.map((t) => t.level)).toEqual([undefined, 0, 1]);
    expect(s.walls?.map((w) => [w.id, w.level])).toEqual([['w2', 1]]);
    expect(s.playerLevel).toBe(1);
  });

  it('setPlayerLevel e clampLevelIn limitam às camadas existentes', () => {
    const sc = scene('a', { levels: [{ id: 'l1', name: '1' }] });
    expect(clampLevelIn(sc, 7)).toBe(1);
    expect(clampLevelIn(sc, -2)).toBe(0);
    expect(clampLevelIn(null, 3)).toBe(0);
    expect(setPlayerLevel(table(sc), { sceneId: 'a', level: 9 }).scenes[0].playerLevel).toBe(1);
  });
});
