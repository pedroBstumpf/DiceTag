import { ExploredData, TableState, Wall } from '../../../core/models/table-session.model';
import { mapScene, patchScene } from './helpers';

/** Comandos da névoa de guerra, da memória da névoa e das paredes/portas de uma cena. */

export function setFog(state: TableState, p: { sceneId: string; enabled: boolean }): TableState {
  return mapScene(state, p.sceneId, (sc) => ({ ...sc, fog: { ...sc.fog, enabled: p.enabled } }));
}

/** Liga/desliga a memória da névoa (lembrar áreas exploradas). */
export function setFogMemory(state: TableState, p: { sceneId: string; memory: boolean }): TableState {
  return mapScene(state, p.sceneId, (sc) => ({ ...sc, fog: { enabled: sc.fog?.enabled ?? false, memory: p.memory } }));
}

/** Grava a máscara de áreas exploradas (sem `explored` = esquece tudo). */
export function setExplored(state: TableState, p: { sceneId: string; explored?: ExploredData }): TableState {
  return patchScene(state, p.sceneId, { explored: p.explored });
}

/** Acrescenta uma parede (já com id e camada). */
export function addWall(state: TableState, p: { sceneId: string; wall: Wall }): TableState {
  return mapScene(state, p.sceneId, (sc) => ({ ...sc, walls: [...(sc.walls ?? []), p.wall] }));
}

/** Substitui uma parede (mover a parede ou um ponto). */
export function updateWall(state: TableState, p: { sceneId: string; wall: Wall }): TableState {
  return mapScene(state, p.sceneId, (sc) => ({ ...sc, walls: (sc.walls ?? []).map((w) => (w.id === p.wall.id ? p.wall : w)) }));
}

/** Abre ou fecha uma porta. */
export function toggleDoor(state: TableState, p: { sceneId: string; doorId: string }): TableState {
  return mapScene(state, p.sceneId, (sc) => ({
    ...sc,
    walls: (sc.walls ?? []).map((w) => (w.id === p.doorId && w.kind === 'door' ? { ...w, open: !w.open } : w)),
  }));
}

export function removeWall(state: TableState, p: { sceneId: string; wallId: string }): TableState {
  return mapScene(state, p.sceneId, (sc) => ({ ...sc, walls: (sc.walls ?? []).filter((w) => w.id !== p.wallId) }));
}
