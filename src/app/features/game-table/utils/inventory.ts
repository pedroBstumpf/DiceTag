import { InventoryEntry } from '../../../core/models/table-session.model';

/** Quantidade do item (itens antigos, sem quantidade, valem 1). */
export function quantityOf(item: InventoryEntry): number {
  return item.quantity ?? 1;
}

/**
 * Tira uma unidade do item `inventoryId`.
 * - `keepEmpty` (loja de NPC): a linha fica com quantidade 0 (o mestre pode repor).
 * - Senão (personagem): a linha some ao zerar.
 * Devolve a lista nova e se a linha saiu da lista (`removed`).
 */
export function takeOne(list: InventoryEntry[], inventoryId: string, keepEmpty: boolean): { list: InventoryEntry[]; removed: boolean } {
  const item = list.find((i) => i.id === inventoryId);
  if (!item || quantityOf(item) < 1) return { list, removed: false };
  const left = quantityOf(item) - 1;
  if (left === 0 && !keepEmpty) return { list: list.filter((i) => i.id !== inventoryId), removed: true };
  return { list: list.map((i) => (i.id === inventoryId ? { ...i, quantity: left } : i)), removed: false };
}

/**
 * Põe uma unidade de `unit` no inventário: soma à pilha de um item idêntico (mesmo item
 * do mundo e mesma personalização, sem imagem própria) ou cria uma linha nova.
 * O preço (de loja) e o "equipado" nunca vão junto.
 */
export function addOne(list: InventoryEntry[], unit: InventoryEntry, newId: () => string): InventoryEntry[] {
  const { price: _price, quantity: _quantity, id: _id, equipped: _equipped, ...item } = unit;
  const stack = item.blobId ? undefined : list.find((i) => sameStack(i, item));
  if (stack) return list.map((i) => (i === stack ? { ...i, quantity: quantityOf(i) + 1 } : i));
  return [...list, { ...item, id: newId() }];
}

/** Mesmo item do mundo e mesma personalização (nome e etiquetas), sem imagem própria. */
function sameStack(a: InventoryEntry, b: Omit<InventoryEntry, 'id'>): boolean {
  return (
    a.itemId === b.itemId &&
    !!a.global === !!b.global &&
    !a.blobId &&
    a.name === b.name &&
    JSON.stringify(a.tags) === JSON.stringify(b.tags)
  );
}
