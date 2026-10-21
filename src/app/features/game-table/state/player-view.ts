import { Point } from '../../../core/models/geometry.model';
import { DoorWall, DroppedItem, METERS_PER_SQUARE, MapNote, TableRole } from '../../../core/models/table-session.model';
import { ExploredMask, isExploredAt } from '../utils/fog-memory';
import { Segment, computeVisibilityPolygon, pointInPolygon } from '../utils/visibility';
import { levelOf } from './helpers';
import { ResolvedToken } from './tokens';

/**
 * O que cada papel enxerga no mapa, em funções puras.
 *
 * A tela usa estas funções para esconder o que está sob a névoa, e o servidor usa as MESMAS
 * para montar o estado que envia a cada jogador (`server/src/realtime/projection.ts`):
 * esconder só na tela não basta, porque o jogador pode ler os dados recebidos.
 */

// --- Origens de visão ----------------------------------------------------------

/** Origem de visão: centro do token e alcance em px do mapa. */
export interface VisionSource {
  x: number;
  y: number;
  range: number;
}

/**
 * Origens de visão da camada: os tokens dela com visão ligada (alcance convertido de metros
 * para px do mapa). A visão é do grupo: todo token com visão ligada revela o mapa a todos.
 */
export function visionSourcesOf(tokens: readonly ResolvedToken[], level: number, gridSize: number): VisionSource[] {
  return tokens
    .filter((t) => t.vision.enabled && levelOf(t.placement) === level)
    .map((t) => ({ x: t.placement.x, y: t.placement.y, range: (t.vision.range / METERS_PER_SQUARE) * gridSize }));
}

/** Mesmas origens? (igualdade por valor: evita recalcular a visão quando nada que a afeta mudou) */
export function sameVisionSources(a: readonly VisionSource[], b: readonly VisionSource[]): boolean {
  return a.length === b.length && a.every((s, i) => s.x === b[i].x && s.y === b[i].y && s.range === b[i].range);
}

/** Polígonos de visão de cada origem, bloqueados pelos segmentos de parede. */
export function visionPolygonsOf(sources: readonly VisionSource[], segments: Segment[]): Point[][] {
  return sources.map((s) => computeVisibilityPolygon(s, s.range, segments));
}

// --- Visibilidade --------------------------------------------------------------

/** Áreas que os tokens enxergam agora e a memória do que já foi visto. */
export interface FogView {
  /** Névoa ligada na cena. */
  enabled: boolean;
  /** Polígonos de visão dos tokens da camada em foco. */
  polygons: Point[][];
  /** Áreas exploradas (null = memória desligada ou vazia). */
  explored: ExploredMask | null;
}

/** O ponto está em alguma área visível? (sem névoa, tudo é visível) */
export function isPointVisible(p: Point, fog: FogView): boolean {
  if (!fog.enabled) return true;
  return fog.polygons.some((poly) => pointInPolygon(p, poly));
}

/** Visível agora ou numa área já explorada (o jogador lembra o que viu). */
function seenOrExplored(p: Point, fog: FogView): boolean {
  return isPointVisible(p, fog) || (!!fog.explored && isExploredAt(fog.explored, p));
}

/** Tokens que o papel vê: o jogador, com névoa, só os visíveis agora (personagens sempre aparecem). */
export function visibleTokensFor(tokens: ResolvedToken[], role: TableRole, fog: FogView): ResolvedToken[] {
  if (role !== 'player' || !fog.enabled) return tokens;
  return tokens.filter((t) => t.entry.kind === 'character' || isPointVisible(t.placement, fog));
}

/** Itens no chão que o papel vê: o jogador, com névoa, só os que algum token enxerga agora. */
export function visibleDropsFor(drops: DroppedItem[], role: TableRole, fog: FogView): DroppedItem[] {
  if (role !== 'player' || !fog.enabled) return drops;
  return drops.filter((d) => isPointVisible(d, fog));
}

/** Anotações que o papel vê: o jogador não vê as "só mestre" nem as fora da visão e da memória. */
export function visibleNotesFor(notes: MapNote[], role: TableRole, fog: FogView): MapNote[] {
  if (role !== 'player') return notes;
  return notes.filter((n) => !n.gmOnly && seenOrExplored(n, fog));
}

/**
 * Portas que o papel vê: o jogador, com névoa, só as que algum token enxerga agora
 * (`seenNow`, teste de segmento) ou cujo meio está numa área explorada.
 */
export function visibleDoorsFor(
  doors: DoorWall[],
  role: TableRole,
  fog: FogView,
  seenNow: (door: DoorWall) => boolean,
): DoorWall[] {
  if (role !== 'player' || !fog.enabled) return doors;
  return doors.filter((d) => seenNow(d) || (!!fog.explored && isExploredAt(fog.explored, midpoint(d.points))));
}

function midpoint([a, b]: Point[]): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
