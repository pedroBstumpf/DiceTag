import { DroppedItem, MAX_TOKEN_SIZE, MIN_TOKEN_SIZE, Scene, TableState } from '../../../core/models/table-session.model';
import { mapScene } from './helpers';

/**
 * Itens largados no mapa ("drops"): comandos puros para largar, mover, alterar e tirar.
 * Largar do inventário e pegar do chão são comandos únicos, em `state/inventory.ts`.
 */

/** Item largado (em qualquer das cenas). */
export function findDrop(scenes: readonly Scene[], dropId: string): { scene: Scene; drop: DroppedItem } | undefined {
  for (const scene of scenes) {
    const drop = scene.drops?.find((d) => d.id === dropId);
    if (drop) return { scene, drop };
  }
  return undefined;
}

/** Aplica `fn` ao item `dropId` (só a cena que o contém muda de referência). */
function mapDrop(state: TableState, dropId: string, fn: (drop: DroppedItem) => DroppedItem): TableState {
  const found = findDrop(state.scenes, dropId);
  if (!found) return state;
  return mapScene(state, found.scene.id, (sc) => ({ ...sc, drops: (sc.drops ?? []).map((d) => (d.id === dropId ? fn(d) : d)) }));
}

/** Larga um item (já montado: id, posição, camada e a unidade do item) na cena. */
export function addDrop(state: TableState, p: { sceneId: string; drop: DroppedItem }): TableState {
  return mapScene(state, p.sceneId, (sc) => ({ ...sc, drops: [...(sc.drops ?? []), p.drop] }));
}

export function moveDrop(state: TableState, p: { dropId: string; x: number; y: number }): TableState {
  return mapDrop(state, p.dropId, (d) => ({ ...d, x: p.x, y: p.y }));
}

/** Mestre: quantidade da pilha no chão (mínimo 1; ausente = 1). */
export function setDropQuantity(state: TableState, p: { dropId: string; quantity: number }): TableState {
  const quantity = Math.max(1, Math.round(p.quantity));
  return mapDrop(state, p.dropId, (d) => {
    const { quantity: _old, ...item } = d.item;
    return { ...d, item: quantity === 1 ? item : { ...item, quantity } };
  });
}

/** Mestre: tamanho (em quadrados, dentro dos limites dos tokens) e cor da borda do item no mapa. */
export function updateDrop(state: TableState, p: { dropId: string; patch: Partial<Pick<DroppedItem, 'size' | 'color'>> }): TableState {
  const patch = { ...p.patch };
  if (patch.size !== undefined) patch.size = Math.min(MAX_TOKEN_SIZE, Math.max(MIN_TOKEN_SIZE, patch.size));
  return mapDrop(state, p.dropId, (d) => ({ ...d, ...patch }));
}

/** Tira o item do mapa (pego por alguém ou removido pelo mestre). */
export function removeDrop(state: TableState, { dropId }: { dropId: string }): TableState {
  const found = findDrop(state.scenes, dropId);
  if (!found) return state;
  return mapScene(state, found.scene.id, (sc) => ({ ...sc, drops: (sc.drops ?? []).filter((d) => d.id !== dropId) }));
}
