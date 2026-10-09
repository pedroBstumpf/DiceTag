import { LoreFolder, LoreItemOverride, TableItem, TableLore, TableState } from '../../../core/models/table-session.model';
import { NoPayload } from './helpers';
import { EMPTY_LORE } from './table-state';

/**
 * Comandos da organização da aba Lore nesta mesa (pastas e ajustes locais) e dos itens
 * criados na mesa. Nada aqui altera ou apaga os itens do Worldbuild / Lore geral.
 */

// --- Pastas ------------------------------------------------------------------

export function addLoreFolder(state: TableState, { folder }: { folder: LoreFolder }): TableState {
  return patchLore(state, (l) => ({ ...l, folders: [...l.folders, folder] }));
}

export function renameLoreFolder(state: TableState, p: { folderId: string; name: string }): TableState {
  const name = p.name.trim();
  if (!name) return state;
  return patchLore(state, (l) => ({ ...l, folders: l.folders.map((f) => (f.id === p.folderId ? { ...f, name } : f)) }));
}

/** Mestre: revela ou esconde dos jogadores tudo o que está na pasta. */
export function toggleLoreFolderPublic(state: TableState, { folderId }: { folderId: string }): TableState {
  return patchLore(state, (l) => ({
    ...l,
    folders: l.folders.map((f) => (f.id === folderId ? { ...f, public: !f.public || undefined } : f)),
  }));
}

/** Exclui a pasta da mesa; os itens dela voltam para a raiz da aba Lore. */
export function removeLoreFolder(state: TableState, { folderId }: { folderId: string }): TableState {
  return patchLore(state, (l) => ({
    folders: l.folders.filter((f) => f.id !== folderId),
    items: Object.fromEntries(
      Object.entries(l.items).map(([itemId, o]) => [itemId, o.folderId === folderId ? { ...o, folderId: undefined } : o]),
    ),
  }));
}

// --- Ajustes por item --------------------------------------------------------

/** Renomeia o item só nesta mesa (nome vazio ou igual ao original volta ao original). */
export function renameLoreItem(state: TableState, p: { itemId: string; originalName: string; name: string }): TableState {
  const name = p.name.trim();
  return patchLoreItem(state, p.itemId, { name: name && name !== p.originalName ? name : undefined });
}

/** Move o item para uma pasta da mesa (null = raiz). */
export function moveLoreItem(state: TableState, p: { itemId: string; folderId: string | null }): TableState {
  return patchLoreItem(state, p.itemId, { folderId: p.folderId ?? undefined });
}

/** Remove o item desta mesa (o original continua no Worldbuild / Lore geral). */
export function hideLoreItem(state: TableState, { itemId }: { itemId: string }): TableState {
  return patchLoreItem(state, itemId, { hidden: true });
}

/** Traz de volta todos os itens removidos desta mesa. */
export function restoreLoreItems(state: TableState, _payload: NoPayload = {}): TableState {
  return patchLore(state, (l) => ({
    ...l,
    items: Object.fromEntries(Object.entries(l.items).map(([id, o]) => [id, { ...o, hidden: undefined }])),
  }));
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

// --- Internos ----------------------------------------------------------------

function patchLoreItem(state: TableState, itemId: string, patch: LoreItemOverride): TableState {
  return patchLore(state, (l) => ({ ...l, items: { ...l.items, [itemId]: { ...l.items[itemId], ...patch } } }));
}

function patchLore(state: TableState, fn: (l: TableLore) => TableLore): TableState {
  return { ...state, lore: fn(state.lore ?? EMPTY_LORE) };
}
