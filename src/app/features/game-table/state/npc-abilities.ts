import { TableEntry } from '../../../core/models/table-session.model';
import { WorldItem } from '../../../core/models/world-item.model';

/**
 * Habilidades dos NPCs do bestiário: moram no NPC do mundo (`WorldItem.abilities`) e, na mesa,
 * aparecem como ações (`automation`) do NPC-referência. Funções puras, sem Angular.
 */

/** Uma habilidade como ação da mesa e o NPC do mundo onde ela mora. */
export interface NpcAbility {
  entry: TableEntry;
  npcId: string;
}

/**
 * Habilidades de todos os NPCs-referência da mesa, como ações com dono = a entrada do NPC.
 * Se o mesmo NPC do mundo estiver na mesa mais de uma vez, as habilidades ficam só com a
 * primeira referência (os ids das ações não se repetem).
 */
export function npcAbilitiesOf(entries: TableEntry[], npcOf: (entry: TableEntry) => WorldItem | undefined): NpcAbility[] {
  const seen = new Set<string>();
  const result: NpcAbility[] = [];
  for (const entry of entries) {
    const npc = npcOf(entry);
    if (!npc || seen.has(npc.id)) continue;
    seen.add(npc.id);
    for (const ability of npc.abilities ?? []) {
      result.push({ entry: { ...ability, kind: 'automation', ownerEntryId: entry.id }, npcId: npc.id });
    }
  }
  return result;
}

/** A ação como fica guardada no NPC do mundo (sem dono: o dono é o próprio NPC). */
export function toStoredAbility(entry: TableEntry): TableEntry {
  const { ownerEntryId: _owner, ...ability } = entry;
  return { ...ability, kind: 'automation' };
}

/** Lista de habilidades com `ability` incluída (ou substituída, se o id já existe). */
export function withAbility(list: TableEntry[] | undefined, ability: TableEntry): TableEntry[] {
  const current = list ?? [];
  return current.some((a) => a.id === ability.id) ? current.map((a) => (a.id === ability.id ? ability : a)) : [...current, ability];
}

/** Lista de habilidades sem a de id `id`. */
export function withoutAbility(list: TableEntry[] | undefined, id: string): TableEntry[] {
  return (list ?? []).filter((a) => a.id !== id);
}
