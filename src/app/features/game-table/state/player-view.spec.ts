import { Point } from '../../../core/models/geometry.model';
import { DoorWall, MapNote, TableEntry, defaultToken } from '../../../core/models/table-session.model';
import { createMask, markPolygons } from '../utils/fog-memory';
import { FogView, isPointVisible, visibleDoorsFor, visibleNotesFor, visibleTokensFor } from './player-view';
import { resolveToken } from './tokens';

const square = (x: number, y: number, size: number): Point[] => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];
/** Névoa ligada; os tokens enxergam só o quadrado 0–100. */
const fog: FogView = { enabled: true, polygons: [square(0, 0, 100)], explored: null };
const entry = (kind: TableEntry['kind']): TableEntry => ({ id: kind, kind, name: kind, createdAt: 0 });
const token = (kind: TableEntry['kind'], x: number) =>
  resolveToken({ id: `${kind}-${x}`, entryId: kind, x, y: 50 }, entry(kind), defaultToken(kind));
const note = (id: string, x: number, gmOnly = false): MapNote => ({ id, x, y: 50, title: '', text: '', color: '', gmOnly });

describe('o que cada papel vê', () => {
  it('sem névoa, tudo é visível', () => {
    expect(isPointVisible({ x: 999, y: 999 }, { ...fog, enabled: false })).toBe(true);
    expect(isPointVisible({ x: 999, y: 999 }, fog)).toBe(false);
  });

  it('jogador não vê NPCs fora da visão; personagens sempre aparecem; o mestre vê tudo', () => {
    const tokens = [token('npc', 50), token('npc', 500), token('character', 500)];
    expect(visibleTokensFor(tokens, 'player', fog).map((t) => t.placement.id)).toEqual(['npc-50', 'character-500']);
    expect(visibleTokensFor(tokens, 'gm', fog)).toBe(tokens);
  });

  it('jogador não vê anotações só do mestre nem fora da visão, mas lembra as exploradas', () => {
    const notes = [note('visivel', 50), note('segredo', 50, true), note('longe', 500)];
    expect(visibleNotesFor(notes, 'player', fog).map((n) => n.id)).toEqual(['visivel']);
    const explored = createMask(1000, 1000);
    markPolygons(explored, [square(400, 0, 200)]);
    expect(visibleNotesFor(notes, 'player', { ...fog, explored }).map((n) => n.id)).toEqual(['visivel', 'longe']);
    expect(visibleNotesFor(notes, 'gm', fog)).toBe(notes);
  });

  it('portas: o jogador vê as que algum token enxerga ou que já explorou', () => {
    const door = (id: string, x: number): DoorWall => ({ id, kind: 'door', points: [{ x, y: 50 }, { x: x + 10, y: 50 }], open: false });
    const doors = [door('perto', 50), door('longe', 500)];
    const seenNow = (d: DoorWall) => isPointVisible(d.points[0], fog);
    expect(visibleDoorsFor(doors, 'player', fog, seenNow).map((d) => d.id)).toEqual(['perto']);
    expect(visibleDoorsFor(doors, 'gm', fog, seenNow)).toBe(doors);
  });
});
