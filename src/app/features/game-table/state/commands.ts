import { TableState } from '../../../core/models/table-session.model';
import { addChatMessage, clearChat } from './chat';
import { addEntry, removeEntry, setSoundMaster, updateEntry } from './entries';
import { addWall, removeWall, setExplored, setFog, setFogMemory, toggleDoor, updateWall } from './fog';
import { addStroke, eraseStrokes, restoreStrokes } from './drawings';
import { addDrop, moveDrop, removeDrop, setDropQuantity, updateDrop } from './drops';
import { addFixedFx, clearFixedFx, removeFixedFx } from './fixed-fx';
import { dropFromInventory, pickUpDrop, transferItem } from './inventory';
import { addLevel, removeLevel, renameLevel, setLevelImage, setPlayerLevel } from './levels';
import { addTableItem, toggleLoreReveal, updateTableItem } from './lore';
import { addNote, removeNote, updateNote } from './notes';
import {
  addScene,
  addSceneFolder,
  moveSceneToFolder,
  removeScene,
  removeSceneFolder,
  renameSceneFolder,
  setActiveScene,
  updateScene,
} from './scenes';
import { moveToken, moveTokens, placeToken, removeToken, toggleTokenPublic, updatePlacement } from './tokens';

/**
 * Catálogo de comandos da mesa: toda alteração do `TableState` é um destes nomes + um payload.
 *
 * Cada comando é uma função pura `(estado, payload) → novo estado`, e o payload é serializável
 * (ids, horários e sorteios já vêm prontos de quem dispara). Isso permite:
 * - testar cada mutação sem Angular (specs em `state/`);
 * - no multiplayer, enviar o comando (`{ type, payload }`) ao servidor em vez da mesa inteira,
 *   e o servidor aplicar a MESMA função para chegar ao mesmo estado.
 */
export const TABLE_COMMANDS = {
  // Cenas e pastas
  addScene,
  updateScene,
  setActiveScene,
  removeScene,
  addSceneFolder,
  renameSceneFolder,
  removeSceneFolder,
  moveSceneToFolder,
  // Camadas do mapa
  addLevel,
  renameLevel,
  setLevelImage,
  removeLevel,
  setPlayerLevel,
  // Arquivos da mesa
  addEntry,
  updateEntry,
  removeEntry,
  setSoundMaster,
  // Tokens
  placeToken,
  updatePlacement,
  moveToken,
  moveTokens,
  removeToken,
  toggleTokenPublic,
  // Itens largados no mapa
  addDrop,
  moveDrop,
  setDropQuantity,
  updateDrop,
  removeDrop,
  // Itens que mudam de lugar (um comando só: nunca valem pela metade)
  transferItem,
  dropFromInventory,
  pickUpDrop,
  // Névoa e paredes
  setFog,
  setFogMemory,
  setExplored,
  addWall,
  updateWall,
  toggleDoor,
  removeWall,
  // Desenhos e anotações
  addStroke,
  eraseStrokes,
  restoreStrokes,
  addNote,
  updateNote,
  removeNote,
  // Efeitos especiais fixos no mapa
  addFixedFx,
  removeFixedFx,
  clearFixedFx,
  // Chat
  addChatMessage,
  clearChat,
  // Lore da mesa (pastas reveladas) e itens criados na mesa
  toggleLoreReveal,
  addTableItem,
  updateTableItem,
} as const;

/** Nome de um comando da mesa. */
export type TableCommandType = keyof typeof TABLE_COMMANDS;

/** Payload do comando `K`. */
export type TableCommandPayload<K extends TableCommandType> = Parameters<(typeof TABLE_COMMANDS)[K]>[1] & object;

/** Um comando da mesa, pronto para aplicar (ou, no futuro, enviar ao servidor). */
export type TableCommand = { [K in TableCommandType]: { type: K; payload: TableCommandPayload<K> } }[TableCommandType];

/** Aplica um comando ao estado. Comando desconhecido (ex.: de uma versão mais nova) = estado igual. */
export function applyCommand(state: TableState, command: TableCommand): TableState {
  const reducer = TABLE_COMMANDS[command.type] as ((s: TableState, p: unknown) => TableState) | undefined;
  return reducer ? reducer(state, command.payload) : state;
}
