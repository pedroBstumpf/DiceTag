import { MAX_MAP_LEVELS, MapLevel, Scene, TableState } from '../../../core/models/table-session.model';
import { levelOf, mapScene } from './helpers';

/**
 * Comandos das camadas do mapa (térreo = 0, usa o mapa da cena; as de cima ficam em
 * `Scene.levels`, de baixo para cima). Índices sempre contam o térreo.
 */

/** Número de camadas da cena (térreo incluído). */
export function levelCountOf(scene: Scene | null | undefined): number {
  return 1 + (scene?.levels?.length ?? 0);
}

/** Limita uma camada às existentes na cena. */
export function clampLevelIn(scene: Scene | null | undefined, level: number): number {
  return Math.min(Math.max(0, Math.round(level)), levelCountOf(scene) - 1);
}

/** Acrescenta uma camada no topo (respeita MAX_MAP_LEVELS). */
export function addLevel(state: TableState, p: { sceneId: string; level: MapLevel }): TableState {
  return mapScene(state, p.sceneId, (sc) =>
    levelCountOf(sc) >= MAX_MAP_LEVELS ? sc : { ...sc, levels: [...(sc.levels ?? []), p.level] },
  );
}

export function renameLevel(state: TableState, p: { sceneId: string; index: number; name: string }): TableState {
  const name = p.name.trim();
  if (p.index < 1 || !name) return state;
  return patchLevel(state, p.sceneId, p.index, { name });
}

/** Imagem de uma camada de cima (sem `blobId` = vira "ar"). O térreo usa `updateScene`. */
export function setLevelImage(state: TableState, p: { sceneId: string; index: number; blobId?: string }): TableState {
  if (p.index < 1) return state;
  return patchLevel(state, p.sceneId, p.index, { blobId: p.blobId });
}

/** Exclui uma camada de cima: os tokens e itens dela e de cima descem uma; as paredes dela são apagadas. */
export function removeLevel(state: TableState, p: { sceneId: string; index: number }): TableState {
  const { index } = p;
  return mapScene(state, p.sceneId, (sc) => {
    const level = sc.levels?.[index - 1];
    if (index < 1 || !level) return sc;
    const playerLevel = sc.playerLevel ?? 0;
    return {
      ...sc,
      levels: (sc.levels ?? []).filter((l) => l.id !== level.id),
      tokens: (sc.tokens ?? []).map((t) => (levelOf(t) >= index ? { ...t, level: levelOf(t) - 1 } : t)),
      ...(sc.drops && { drops: sc.drops.map((d) => (levelOf(d) >= index ? { ...d, level: levelOf(d) - 1 } : d)) }),
      walls: (sc.walls ?? [])
        .filter((w) => levelOf(w) !== index)
        .map((w) => (levelOf(w) > index ? { ...w, level: levelOf(w) - 1 } : w)),
      playerLevel: playerLevel >= index ? playerLevel - 1 : playerLevel,
    };
  });
}

/** Camada que os jogadores veem. */
export function setPlayerLevel(state: TableState, p: { sceneId: string; level: number }): TableState {
  return mapScene(state, p.sceneId, (sc) => ({ ...sc, playerLevel: clampLevelIn(sc, p.level) }));
}

function patchLevel(state: TableState, sceneId: string, index: number, patch: Partial<MapLevel>): TableState {
  return mapScene(state, sceneId, (sc) => ({
    ...sc,
    levels: (sc.levels ?? []).map((l, i) => (i === index - 1 ? { ...l, ...patch } : l)),
  }));
}
