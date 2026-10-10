import { Point } from '../../../core/models/geometry.model';
import { DoorWall, DroppedItem, MapNote, TableRole } from '../../../core/models/table-session.model';
import { ExploredMask, isExploredAt } from '../utils/fog-memory';
import { pointInPolygon } from '../utils/visibility';
import { ResolvedToken } from './tokens';

/**
 * O que cada papel enxerga no mapa, em funções puras.
 *
 * Hoje a tela usa estas funções para esconder o que está sob a névoa. No multiplayer, o
 * servidor deve usar as MESMAS regras para montar o estado que envia a cada jogador:
 * esconder só na tela não basta, porque o jogador pode ler os dados recebidos.
 */

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
