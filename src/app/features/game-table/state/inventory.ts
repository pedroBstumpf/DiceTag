import { CharacterSheet, InventoryEntry, TableEntry, TableState, TokenPlacement, normalizeSheet } from '../../../core/models/table-session.model';
import { addOne, quantityOf, takeOne, unitOf } from '../utils/inventory';
import { addDrop, findDrop, removeDrop } from './drops';
import { findPlacement, mapPlacement, tokenSheetPlacement } from './helpers';

/**
 * Itens que mudam de lugar: de um inventário para outro (compra, loot, "Dar para"), para o chão do
 * mapa e de volta. Cada operação é UM comando, aplicado de uma vez: com várias pessoas na mesa,
 * dois comandos separados podiam valer pela metade (o item saía de um lugar e não chegava ao outro)
 * ou duplicar a última unidade.
 *
 * Quem pode fazer o quê é conferido antes (`state/permissions.ts` na tela; regras dos comandos no
 * servidor). Aqui só valem os limites do próprio dado: sem unidade ou sem Eiros, o estado não muda.
 */

/** Onde mora um inventário dentro do estado da mesa. */
export interface InventoryHolder {
  /** Ficha dona das permissões. */
  entry: TableEntry;
  /** Token de NPC, quando a ficha é a cópia dele. */
  placement?: TokenPlacement;
  sheet: CharacterSheet;
  /** NPC mantém a linha mesmo em 0 (loja esgotada); personagem perde a linha ao zerar. */
  keepEmpty: boolean;
}

/**
 * Inventário da ficha `sheetId` (id da entrada ou `npc:<id do token>`). null quando não está na
 * mesa: ficha inexistente ou NPC-referência, cuja ficha base mora no Worldbuild.
 */
export function inventoryHolder(state: TableState, sheetId: string): InventoryHolder | null {
  const placementId = tokenSheetPlacement(sheetId);
  if (placementId) {
    const placement = findPlacement(state.scenes, placementId);
    const entry = placement && state.entries.find((e) => e.id === placement.entryId);
    if (!placement || entry?.kind !== 'npc') return null;
    return { entry, placement, sheet: normalizeSheet(placement.sheet ?? entry.sheet), keepEmpty: true };
  }
  const entry = state.entries.find((e) => e.id === sheetId);
  if (!entry || (entry.kind !== 'character' && entry.kind !== 'npc') || entry.worldNpcId) return null;
  return { entry, sheet: normalizeSheet(entry.sheet), keepEmpty: entry.kind === 'npc' };
}

/** Grava a ficha no lugar dela (só a entrada ou o token muda de referência). */
function writeSheet(state: TableState, sheetId: string, sheet: CharacterSheet): TableState {
  const placementId = tokenSheetPlacement(sheetId);
  if (placementId) return mapPlacement(state, placementId, (p) => ({ ...p, sheet }));
  return { ...state, entries: state.entries.map((e) => (e.id === sheetId ? { ...e, sheet } : e)) };
}

/**
 * Tira uma unidade do inventário. A imagem personalizada vai junto quando a linha some; enquanto a
 * linha ficar, a unidade leva a cópia `blobId` (cada lugar cuida da sua imagem) ou fica sem imagem própria.
 */
function takeUnit(holder: InventoryHolder, inventoryId: string, blobId: string | undefined): { list: InventoryEntry[]; unit: InventoryEntry } | null {
  const item = holder.sheet.inventory.find((i) => i.id === inventoryId);
  if (!item || quantityOf(item) < 1) return null;
  const taken = takeOne(holder.sheet.inventory, inventoryId, holder.keepEmpty);
  const unit: InventoryEntry = { ...item };
  const image = taken.removed ? item.blobId : blobId;
  if (image) unit.blobId = image;
  else delete unit.blobId;
  return { list: taken.list, unit };
}

/** A imagem personalizada precisa ser duplicada antes de tirar esta unidade? (a linha fica na origem) */
export function unitNeedsImageCopy(holder: InventoryHolder, item: InventoryEntry): boolean {
  return !!item.blobId && (holder.keepEmpty || quantityOf(item) > 1);
}

// --- Comandos ----------------------------------------------------------------------

/**
 * Passa uma unidade de um inventário para outro, com a personalização e sem o preço.
 * `cost` sai dos Eiros de quem recebe. `newEntryId`: id da linha, se o item não empilhar em outra.
 */
export function transferItem(
  state: TableState,
  p: { fromId: string; inventoryId: string; toId: string; newEntryId: string; cost?: number; blobId?: string },
): TableState {
  if (p.fromId === p.toId) return state;
  const from = inventoryHolder(state, p.fromId);
  const to = inventoryHolder(state, p.toId);
  if (!from || !to) return state;
  const cost = p.cost ?? 0;
  if (cost > 0 && to.sheet.eiros < cost) return state;
  const taken = takeUnit(from, p.inventoryId, p.blobId);
  if (!taken) return state;
  const left = writeSheet(state, p.fromId, { ...from.sheet, inventory: taken.list });
  return writeSheet(left, p.toId, {
    ...to.sheet,
    inventory: addOne(to.sheet.inventory, taken.unit, () => p.newEntryId),
    ...(cost > 0 && { eiros: to.sheet.eiros - cost }),
  });
}

/** Larga no chão do mapa uma unidade do inventário. */
export function dropFromInventory(
  state: TableState,
  p: { sceneId: string; sheetId: string; inventoryId: string; dropId: string; itemEntryId: string; x: number; y: number; level?: number; blobId?: string },
): TableState {
  if (!state.scenes.some((s) => s.id === p.sceneId)) return state;
  const holder = inventoryHolder(state, p.sheetId);
  const taken = holder && takeUnit(holder, p.inventoryId, p.blobId);
  if (!holder || !taken) return state;
  const left = writeSheet(state, p.sheetId, { ...holder.sheet, inventory: taken.list });
  return addDrop(left, {
    sceneId: p.sceneId,
    drop: {
      id: p.dropId,
      x: p.x,
      y: p.y,
      ...(p.level !== undefined && p.level > 0 && { level: p.level }),
      item: { ...unitOf(taken.unit), id: p.itemEntryId },
    },
  });
}

/** Pega do chão a pilha inteira, com a imagem, e tira o item do mapa. */
export function pickUpDrop(state: TableState, p: { dropId: string; sheetId: string; newEntryId: string }): TableState {
  const found = findDrop(state.scenes, p.dropId);
  const holder = inventoryHolder(state, p.sheetId);
  if (!found || !holder) return state;
  const { item } = found.drop;
  const inventory = addOne(holder.sheet.inventory, item, () => p.newEntryId, quantityOf(item));
  return removeDrop(writeSheet(state, p.sheetId, { ...holder.sheet, inventory }), { dropId: p.dropId });
}
