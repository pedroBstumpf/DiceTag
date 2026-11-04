import { TableItem, TableState } from '../../../core/models/table-session.model';
import { EMPTY_LORE } from './table-state';

/**
 * Comandos da aba Lore desta mesa (o que o mestre revelou) e dos itens criados na mesa.
 * Os itens e pastas do mundo são alterados pelo WorldbuildService, não por aqui.
 */

// --- Pastas reveladas --------------------------------------------------------

/** Mestre: revela ou esconde dos jogadores uma pasta do mundo (e tudo dentro dela). */
export function toggleLoreReveal(state: TableState, { folderId }: { folderId: string }): TableState {
  const revealed = (state.lore ?? EMPTY_LORE).revealed;
  const next = revealed.includes(folderId) ? revealed.filter((id) => id !== folderId) : [...revealed, folderId];
  return { ...state, lore: { revealed: next } };
}

// --- Itens criados na mesa ---------------------------------------------------

export function addTableItem(state: TableState, { item }: { item: TableItem }): TableState {
  return { ...state, items: [...(state.items ?? []), item] };
}

export function updateTableItem(
  state: TableState,
  p: { itemId: string; patch: Partial<Pick<TableItem, 'name' | 'tags' | 'description' | 'blobId'>> },
): TableState {
  return { ...state, items: (state.items ?? []).map((i) => (i.id === p.itemId ? { ...i, ...p.patch } : i)) };
}

/**
 * Itens do mundo citados no estado da mesa: inventários (das fichas e dos tokens) e itens no chão.
 * Quem recebe esse estado precisa do cartão deles, mesmo fora das pastas reveladas: o item do
 * inventário de um jogador não pode aparecer como "excluído" só porque a pasta dele é secreta.
 * Itens criados na mesa (`table`) não são do mundo.
 */
export function worldItemRefs(state: TableState): string[] {
  const refs = new Set<string>();
  const add = (list: readonly { itemId: string; table?: boolean }[] | undefined) => {
    for (const item of list ?? []) if (!item.table) refs.add(item.itemId);
  };
  for (const entry of state.entries) add(entry.sheet?.inventory);
  for (const scene of state.scenes) {
    for (const token of scene.tokens ?? []) add(token.sheet?.inventory);
    add((scene.drops ?? []).map((d) => d.item));
  }
  return [...refs];
}
