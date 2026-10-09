import { Scene, SceneFolder, TableState } from '../../../core/models/table-session.model';
import { patchScene } from './helpers';

/**
 * Comandos das cenas e das pastas de cenas: (estado, payload) → novo estado.
 * Puros e com payload serializável — o mesmo formato que um servidor receberia.
 */

// --- Cenas -------------------------------------------------------------------

/** Acrescenta a cena e a torna ativa. */
export function addScene(state: TableState, { scene }: { scene: Scene }): TableState {
  return { ...state, scenes: [...state.scenes, scene], activeSceneId: scene.id };
}

export function updateScene(state: TableState, p: { sceneId: string; patch: Partial<Omit<Scene, 'id'>> }): TableState {
  return patchScene(state, p.sceneId, p.patch);
}

export function setActiveScene(state: TableState, { sceneId }: { sceneId: string }): TableState {
  return { ...state, activeSceneId: sceneId };
}

/** Exclui a cena; se era a ativa, a primeira restante passa a ser. */
export function removeScene(state: TableState, { sceneId }: { sceneId: string }): TableState {
  const scenes = state.scenes.filter((sc) => sc.id !== sceneId);
  const activeSceneId = state.activeSceneId === sceneId ? (scenes[0]?.id ?? null) : state.activeSceneId;
  return { ...state, scenes, activeSceneId };
}

// --- Pastas de cenas ---------------------------------------------------------

export function addSceneFolder(state: TableState, { folder }: { folder: SceneFolder }): TableState {
  return { ...state, sceneFolders: [...(state.sceneFolders ?? []), folder] };
}

/** Renomeia a pasta (nome vazio é ignorado). */
export function renameSceneFolder(state: TableState, p: { folderId: string; name: string }): TableState {
  const name = p.name.trim();
  if (!name) return state;
  return { ...state, sceneFolders: (state.sceneFolders ?? []).map((f) => (f.id === p.folderId ? { ...f, name } : f)) };
}

/** Exclui a pasta; as cenas dela continuam, fora de pastas. */
export function removeSceneFolder(state: TableState, { folderId }: { folderId: string }): TableState {
  return {
    ...state,
    sceneFolders: (state.sceneFolders ?? []).filter((f) => f.id !== folderId),
    scenes: state.scenes.map((sc) => (sc.folderId === folderId ? { ...sc, folderId: undefined } : sc)),
  };
}

/** Move a cena para uma pasta (null = fora de pastas). */
export function moveSceneToFolder(state: TableState, p: { sceneId: string; folderId: string | null }): TableState {
  return patchScene(state, p.sceneId, { folderId: p.folderId ?? undefined });
}
