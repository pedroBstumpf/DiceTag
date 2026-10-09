import { WorldItem } from '../../../core/models/world-item.model';

/**
 * Referências de eventos da linha do tempo a itens do mundo — funções puras, sem Angular.
 * Um evento guarda só os ids (`TimelineEvent.refs`); o nome e o tipo vêm sempre do item atual.
 */

/** Sem acentos e em minúsculas (busca tolerante: "raca" acha "Raça"). */
function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Itens que podem ser referenciados: tudo menos pastas e os ids de `exclude` (a própria linha do
 * tempo e o que já está ligado), filtrados pelo nome e em ordem alfabética, até `limit`.
 */
export function referenceCandidates(items: readonly WorldItem[], query: string, exclude: ReadonlySet<string>, limit = 8): WorldItem[] {
  const q = fold(query.trim());
  return items
    .filter((i) => i.type !== 'folder' && !exclude.has(i.id) && (!q || fold(i.name).includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }))
    .slice(0, limit);
}

/** Itens referenciados que ainda existem, na ordem em que foram ligados (excluídos somem). */
export function resolveReferences(ids: readonly string[] | undefined, byId: ReadonlyMap<string, WorldItem>): WorldItem[] {
  return (ids ?? []).flatMap((id) => byId.get(id) ?? []);
}
