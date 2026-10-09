import { WorldItem } from '../../../core/models/world-item.model';

/**
 * Importação da antiga Lore geral (removida do app) — funções puras, sem Angular.
 * A Lore geral era um Worldbuild global (`lore:global`); o conteúdo dela passa para
 * o primeiro mundo do usuário, dentro de uma pasta própria.
 */

/** Chave da antiga Lore geral (mantida como cópia de segurança, sem uso). */
export const LEGACY_LORE_KEY = 'lore:global';
/** Marca de que a importação já foi feita (guarda o id do usuário que recebeu). */
export const LEGACY_LORE_IMPORTED_KEY = 'lore:global:imported';
/** Nome da pasta criada para o conteúdo importado. */
export const LEGACY_LORE_FOLDER = 'Lore geral (importada)';

/**
 * Junta os itens da Lore geral aos do mundo: os que estavam na raiz entram na pasta nova
 * (`folder.id`); os ids são mantidos (as mesas continuam achando NPCs, itens e raças) e itens
 * que já existem no mundo não são duplicados. Sem nada a importar, devolve a mesma lista.
 */
export function mergeLegacyLore(items: WorldItem[], lore: WorldItem[], folder: { id: string; now: number }): WorldItem[] {
  const existing = new Set(items.map((i) => i.id));
  const imported = lore.filter((i) => !existing.has(i.id));
  if (!imported.length) return items;
  const root: WorldItem = {
    id: folder.id,
    type: 'folder',
    name: LEGACY_LORE_FOLDER,
    parentId: null,
    createdAt: folder.now,
    updatedAt: folder.now,
  };
  return [...items, root, ...imported.map((i) => (i.parentId === null ? { ...i, parentId: root.id } : i))];
}
