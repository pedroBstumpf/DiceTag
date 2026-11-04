import {
  clampLevelIn,
  decodeMask,
  levelOf,
  resolveToken,
  sameVisionSources,
  visionPolygonsOf,
  visionSourcesOf,
  wallsToSegments,
  type ExploredData,
  type ExploredMask,
  type FogView,
  type Point,
  type ResolvedToken,
  type Scene,
  type Segment,
  type TableEntry,
  type TableState,
  type TokenSettings,
  type VisionSource,
  type Wall,
} from '../domain';

/**
 * Visão dos jogadores calculada no servidor (SPEC.md §3.1), com as mesmas funções puras do
 * front-end (`state/player-view.ts`): a névoa da cena aberta, na camada liberada aos jogadores.
 *
 * A visão é do grupo (todo token com visão ligada revela o mapa a todos), então é calculada uma
 * vez por estado e vale para todos os jogadores da sala.
 */

/** Cena aberta como os jogadores a veem. */
export interface PlayerScene {
  scene: Scene;
  /** Camada dos jogadores (`playerLevel`, limitada às camadas existentes). */
  level: number;
  /** Tokens da cena com a regra de vínculo aplicada (os de fichas inexistentes ficam de fora). */
  tokens: ResolvedToken[];
  fog: FogView;
}

/**
 * Calcula a `PlayerScene` guardando os passos caros. O estado é imutável, então:
 * - paredes → segmentos só quando a lista de paredes (referência) ou a camada mudam;
 * - polígonos de visão só quando os segmentos mudam ou as origens mudam de VALOR (mover um token
 *   sem visão, mexer na ficha ou no chat não recalcula nada);
 * - a memória da névoa só é decodificada quando muda.
 */
export class VisionCache {
  private walls?: { list: readonly Wall[]; level: number; segments: Segment[] };
  private vision?: { segments: Segment[]; sources: VisionSource[]; polygons: Point[][] };
  private explored?: { data: ExploredData; mask: ExploredMask };

  constructor(private readonly tokenOf: (entry: TableEntry) => TokenSettings) {}

  sceneOf(state: TableState): PlayerScene | null {
    const scene = state.scenes.find((s) => s.id === state.activeSceneId);
    if (!scene) return null;
    const level = clampLevelIn(scene, scene.playerLevel ?? 0);
    const entries = new Map(state.entries.map((e) => [e.id, e]));
    const tokens = (scene.tokens ?? []).flatMap((p) => {
      const entry = entries.get(p.entryId);
      return entry ? [resolveToken(p, entry, this.tokenOf(entry))] : [];
    });
    if (!scene.fog?.enabled) return { scene, level, tokens, fog: { enabled: false, polygons: [], explored: null } };

    const segments = this.segmentsOf(scene.walls ?? [], level);
    const polygons = this.polygonsOf(segments, visionSourcesOf(tokens, level, scene.gridSize));
    return { scene, level, tokens, fog: { enabled: true, polygons, explored: this.exploredOf(scene) } };
  }

  /** Esquece os cálculos (o mundo mudou: o token padrão de um NPC pode ter outra visão). */
  clear(): void {
    this.walls = undefined;
    this.vision = undefined;
    this.explored = undefined;
  }

  private segmentsOf(list: readonly Wall[], level: number): Segment[] {
    if (this.walls?.list !== list || this.walls.level !== level) {
      this.walls = { list, level, segments: wallsToSegments(list.filter((w) => levelOf(w) === level)) };
    }
    return this.walls.segments;
  }

  private polygonsOf(segments: Segment[], sources: VisionSource[]): Point[][] {
    if (this.vision?.segments !== segments || !sameVisionSources(this.vision.sources, sources)) {
      this.vision = { segments, sources, polygons: visionPolygonsOf(sources, segments) };
    }
    return this.vision.polygons;
  }

  /** Áreas exploradas (null com a memória desligada ou vazia). */
  private exploredOf(scene: Scene): ExploredMask | null {
    const data = scene.explored;
    if (!data || scene.fog?.memory === false) return null;
    if (this.explored?.data !== data) this.explored = { data, mask: decodeMask(data) };
    return this.explored.mask;
  }
}
