import { Tag } from '../../../core/models/tag.model';
import { InventoryEntry } from '../../../core/models/table-session.model';
import { WorldItem } from '../../../core/models/world-item.model';
import { ITEM_TAG_PREFIX } from './dice';

/** Quantidade do item (itens antigos, sem quantidade, valem 1). */
export function quantityOf(item: InventoryEntry): number {
  return item.quantity ?? 1;
}

// --- Linha do inventário (personalização x original) ------------------------

/** O que o inventário usa do item original (do mundo ou da mesa). */
export type CardItem = Pick<WorldItem, 'id' | 'name' | 'tags' | 'blobId' | 'description'>;

/** De onde vem o original de um item do inventário: o mundo (Worldbuild) ou a mesa. */
export type ItemSource = 'own' | 'table';

/** Onde procurar os originais: itens do mundo aberto e itens da mesa. */
export interface ItemSources {
  own: ReadonlyMap<string, CardItem>;
  table: ReadonlyMap<string, CardItem>;
}

/**
 * Origem do item. Entradas antigas marcadas como da Lore geral (`global`) são procuradas no
 * mundo: a Lore geral foi importada para ele com os mesmos ids.
 */
function sourceOf(entry: InventoryEntry): ItemSource {
  return entry.table ? 'table' : 'own';
}

/** "desta mesa" ou "do mundo" (texto do item excluído). */
export function itemOrigin(entry: InventoryEntry): string {
  return { table: 'desta mesa', own: 'do mundo' }[sourceOf(entry)];
}

/** Linha do inventário: o que o cartão mostra (personalização ou original). */
export interface InventoryRow {
  entry: InventoryEntry;
  /** Item original (ausente quando foi excluído do mundo ou da mesa). */
  item?: CardItem;
  name: string;
  tags: Tag[];
  description: string;
  blobId?: string;
  /** Unidades (na loja, 0 = esgotado). */
  quantity: number;
  /** Tem nome, etiquetas ou imagem próprios deste personagem. */
  custom: boolean;
  /** Original excluído e nada personalizado: não há o que mostrar. */
  missing: boolean;
}

/**
 * Monta a linha de um item do inventário: a personalização da ficha vale no lugar do
 * original (item da mesa ou do mundo).
 */
export function inventoryRow(entry: InventoryEntry, sources: ItemSources): InventoryRow {
  const item = sources[sourceOf(entry)].get(entry.itemId);
  const custom = entry.name !== undefined || entry.tags !== undefined || entry.blobId !== undefined || entry.description !== undefined;
  return {
    entry,
    item,
    name: entry.name ?? item?.name ?? 'Item excluído',
    tags: entry.tags ?? item?.tags ?? [],
    description: entry.description ?? item?.description ?? '',
    blobId: entry.blobId ?? item?.blobId,
    quantity: quantityOf(entry),
    custom,
    missing: !item && !custom,
  };
}

// --- Etiquetas de itens equipados nas rolagens ------------------------------


/** Id da etiqueta de um item equipado nas rolagens: único por linha do inventário. */
export function itemTagId(inventoryId: string, tagId: string): string {
  return `${ITEM_TAG_PREFIX}${inventoryId}:${tagId}`;
}

/** Valor da etiqueta de item na rolagem: o nível dela (sem nível ou 0 = 1). */
export function itemTagLevel(tag: Tag): number {
  return tag.level || 1;
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
    !!a.table === !!b.table &&
    !a.blobId &&
    a.name === b.name &&
    a.description === b.description &&
    JSON.stringify(a.tags) === JSON.stringify(b.tags)
  );
}
