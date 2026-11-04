import { Point } from '../../../core/models/geometry.model';
import { DoorWall, MapNote, TableEntry, defaultToken } from '../../../core/models/table-session.model';
import { createMask, markPolygons } from '../utils/fog-memory';
import { wallsToSegments } from '../utils/visibility';
import {
  FogView,
  isPointVisible,
  sameVisionSources,
  visibleDoorsFor,
  visibleNotesFor,
  visibleTokensFor,
  visionPolygonsOf,
  visionSourcesOf,
} from './player-view';
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

describe('origens e polígonos de visão', () => {
  const withVision = (id: string, x: number, enabled: boolean, level?: number) =>
    resolveToken({ id, entryId: 'character', x, y: 50, level }, entry('character'), {
      ...defaultToken('character'),
      vision: { enabled, range: 3 },
    });

  it('só tokens da camada com visão ligada; alcance de metros para px', () => {
    const tokens = [withVision('a', 10, true), withVision('b', 20, false), withVision('c', 30, true, 1)];
    // 3 m = 2 quadrados de 1,5 m; grade de 70 px
    expect(visionSourcesOf(tokens, 0, 70)).toEqual([{ x: 10, y: 50, range: 140 }]);
    expect(visionSourcesOf(tokens, 1, 70).map((s) => s.x)).toEqual([30]);
  });

  it('igualdade por valor das origens', () => {
    const a = [{ x: 1, y: 2, range: 3 }];
    expect(sameVisionSources(a, [{ x: 1, y: 2, range: 3 }])).toBe(true);
    expect(sameVisionSources(a, [{ x: 1, y: 2, range: 4 }])).toBe(false);
    expect(sameVisionSources(a, [])).toBe(false);
  });

  it('a parede bloqueia a visão', () => {
    const segments = wallsToSegments([{ id: 'w', kind: 'line', points: [{ x: 100, y: -500 }, { x: 100, y: 500 }] }]);
    const [poly] = visionPolygonsOf([{ x: 0, y: 0, range: 300 }], segments);
    const view: FogView = { enabled: true, polygons: [poly], explored: null };
    expect(isPointVisible({ x: 50, y: 0 }, view)).toBe(true);
    expect(isPointVisible({ x: 150, y: 0 }, view)).toBe(false);
  });
});
