import { ChatMessage, MAX_CHAT_MESSAGES, Scene, Stroke, TableState } from '../../../core/models/table-session.model';
import { addChatMessage, clearChat } from './chat';
import { addStroke, eraseStrokes, restoreStrokes, strokesToErase } from './drawings';
import { addWall, removeWall, setExplored, setFog, setFogMemory, toggleDoor, updateWall } from './fog';
import { addNote, removeNote, updateNote } from './notes';

const scene = (extra: Partial<Scene> = {}): Scene => ({ id: 'a', name: 'a', gridSize: 70, showGrid: true, ...extra });
const table = (sc: Scene = scene()): TableState => ({ scenes: [sc], activeSceneId: sc.id, entries: [] });
const stroke = (id: string): Stroke => ({ id, points: [], color: '#fff', width: 4, opacity: 1 });

describe('comandos: névoa e paredes', () => {
  it('setFog mantém a memória; setFogMemory mantém o liga/desliga', () => {
    let s = setFog(table(scene({ fog: { enabled: false, memory: false } })), { sceneId: 'a', enabled: true });
    expect(s.scenes[0].fog).toEqual({ enabled: true, memory: false });
    s = setFogMemory(s, { sceneId: 'a', memory: true });
    expect(s.scenes[0].fog).toEqual({ enabled: true, memory: true });
  });

  it('setExplored sem máscara esquece as áreas exploradas', () => {
    const s = table(scene({ explored: { cell: 10, cols: 1, rows: 1, data: 'AA==' } }));
    expect(setExplored(s, { sceneId: 'a' }).scenes[0].explored).toBeUndefined();
  });

  it('paredes: acrescentar, substituir, abrir porta e remover', () => {
    let s = addWall(table(), { sceneId: 'a', wall: { id: 'w', kind: 'line', points: [] } });
    s = addWall(s, { sceneId: 'a', wall: { id: 'd', kind: 'door', points: [], open: false } });
    s = updateWall(s, { sceneId: 'a', wall: { id: 'w', kind: 'circle', cx: 1, cy: 1, r: 5 } });
    expect(s.scenes[0].walls?.[0].kind).toBe('circle');
    s = toggleDoor(s, { sceneId: 'a', doorId: 'd' });
    expect(s.scenes[0].walls?.[1]).toMatchObject({ open: true });
    // Só portas abrem e fecham
    expect(toggleDoor(s, { sceneId: 'a', doorId: 'w' }).scenes[0].walls?.[0]).toEqual(s.scenes[0].walls?.[0]);
    expect(removeWall(s, { sceneId: 'a', wallId: 'w' }).scenes[0].walls?.map((w) => w.id)).toEqual(['d']);
  });
});

describe('comandos: desenhos', () => {
  it('apagar e restaurar devolve os traços na mesma ordem de sobreposição', () => {
    let s = table(scene({ drawings: ['1', '2', '3', '4'].map(stroke) }));
    const removed = strokesToErase(s.scenes[0].drawings ?? [], ['2', '4']);
    expect(removed.map((r) => r.index)).toEqual([1, 3]);
    s = eraseStrokes(s, { sceneId: 'a', strokeIds: ['2', '4'] });
    expect(s.scenes[0].drawings?.map((d) => d.id)).toEqual(['1', '3']);
    s = restoreStrokes(s, { sceneId: 'a', removed });
    expect(s.scenes[0].drawings?.map((d) => d.id)).toEqual(['1', '2', '3', '4']);
  });

  it('addStroke acrescenta no topo', () => {
    expect(addStroke(table(), { sceneId: 'a', stroke: stroke('x') }).scenes[0].drawings?.map((d) => d.id)).toEqual(['x']);
  });
});

describe('comandos: anotações', () => {
  it('criar, alterar e remover', () => {
    const note = { id: 'n', x: 1, y: 2, title: '', text: '', color: '#fff', gmOnly: false };
    let s = addNote(table(), { sceneId: 'a', note });
    s = updateNote(s, { sceneId: 'a', noteId: 'n', patch: { title: 'Baú', gmOnly: true } });
    expect(s.scenes[0].notes?.[0]).toMatchObject({ title: 'Baú', gmOnly: true, x: 1 });
    expect(removeNote(s, { sceneId: 'a', noteId: 'n' }).scenes[0].notes).toEqual([]);
  });
});

describe('comandos: chat', () => {
  const msg = (id: string): ChatMessage => ({ id, at: 0, userId: 'u', author: 'A', role: 'gm', text: id });

  it('guarda só as últimas mensagens', () => {
    let s = table();
    for (let i = 0; i < MAX_CHAT_MESSAGES + 5; i++) s = addChatMessage(s, { message: msg(`m${i}`) });
    expect(s.chat?.length).toBe(MAX_CHAT_MESSAGES);
    expect(s.chat?.[0].id).toBe('m5');
    expect(clearChat(s).chat).toEqual([]);
  });
});
