import { ChatMessage, MAX_CHAT_MESSAGES, TableState } from '../../../core/models/table-session.model';
import { NoPayload } from './helpers';

/** Comandos do chat da mesa (guarda só as últimas MAX_CHAT_MESSAGES). */

export function addChatMessage(state: TableState, { message }: { message: ChatMessage }): TableState {
  return { ...state, chat: [...(state.chat ?? []), message].slice(-MAX_CHAT_MESSAGES) };
}

export function clearChat(state: TableState, _payload: NoPayload = {}): TableState {
  return { ...state, chat: [] };
}
