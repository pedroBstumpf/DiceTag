import type { TableCommandType } from '../domain';
import type { ClientMessage } from './protocol';

/**
 * Tamanho máximo das mensagens do WebSocket (BACKEND_SECURITY.md §4.1 e §10).
 *
 * `MAX_MESSAGE_BYTES` é o teto do transporte (`maxPayload`: o `ws` derruba a conexão acima dele).
 * Abaixo do teto, cada mensagem tem o próprio limite pelo que carrega: quase todas cabem em
 * poucos KB. Só os comandos que ainda gravam a ficha inteira (com as anotações em texto rico) ou
 * a cena inteira chegam ao teto — até virarem comandos por campo (SPEC.md §1).
 */

const KB = 1024;
export const MAX_MESSAGE_BYTES = 512 * KB;
/** Comandos pequenos (mover, abrir porta, chat, pings…). */
const DEFAULT_BUDGET = 16 * KB;

const COMMAND_BUDGETS: Partial<Record<TableCommandType, number>> = {
  addEntry: MAX_MESSAGE_BYTES,
  updateEntry: MAX_MESSAGE_BYTES,
  placeToken: MAX_MESSAGE_BYTES,
  updatePlacement: MAX_MESSAGE_BYTES,
  addScene: MAX_MESSAGE_BYTES,
  restoreStrokes: 256 * KB,
  eraseStrokes: 256 * KB,
  addStroke: 128 * KB,
  setExplored: 80 * KB,
  addWall: 64 * KB,
  updateWall: 64 * KB,
  clearFixedFx: 64 * KB,
  addNote: 32 * KB,
  updateNote: 32 * KB,
  addDrop: 32 * KB,
  addTableItem: 32 * KB,
  updateTableItem: 32 * KB,
  moveTokens: 32 * KB,
};

/** Limite da mensagem já validada, em bytes. */
export function budgetOf(message: ClientMessage): number {
  if (message.t === 'cmd') return COMMAND_BUDGETS[message.type] ?? DEFAULT_BUDGET;
  // Rolagem: até 100 tags ligadas com Poder
  return message.t === 'roll' ? 32 * KB : DEFAULT_BUDGET;
}
