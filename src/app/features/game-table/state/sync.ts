import { TableState } from '../../../core/models/table-session.model';
import { TableCommand, applyCommand } from './commands';

/**
 * Reconciliação do cliente na mesa online (SPEC.md §1, item 4) — funções puras.
 *
 * - `confirmed`: o último estado que o servidor confirmou (por `ack`, `cmd` ou `state`);
 * - `pending`: comandos desta conta já aplicados na tela, ainda sem resposta do servidor;
 * - `view`: o que a tela mostra = `confirmed` + `pending` reaplicados, na ordem.
 *
 * Comando de outra pessoa entra no confirmado e os pendentes são reaplicados por cima;
 * comando recusado (`nack`) simplesmente sai da lista, e a tela volta ao que o servidor tem.
 */
export interface SyncState {
  confirmed: TableState;
  pending: readonly PendingCommand[];
  view: TableState;
  /** Versão do servidor do estado confirmado. */
  version: number;
}

/** Comando enviado e ainda não respondido; `seq` casa o `ack`/`nack` com o envio. */
export interface PendingCommand {
  seq: number;
  command: TableCommand;
}

/** Começa (ou recomeça, após reconectar) pelo estado que o servidor mandou. */
export function startSync(state: TableState, version: number): SyncState {
  return { confirmed: state, pending: [], view: state, version };
}

/** Comando desta conta: aparece na tela já e fica pendente. Sem efeito = nada muda (nem é enviado). */
export function localCommand(sync: SyncState, seq: number, command: TableCommand): SyncState {
  const view = applyCommand(sync.view, command);
  if (view === sync.view) return sync;
  return { ...sync, view, pending: [...sync.pending, { seq, command }] };
}

/**
 * `ack`: o servidor aceitou o comando `seq`. Vale o payload final dele (o servidor pode carimbar
 * campos, como autor e horário no chat), aplicado sobre o confirmado.
 */
export function ackCommand(sync: SyncState, seq: number, final: TableCommand, version: number): SyncState {
  const pending = sync.pending.filter((p) => p.seq !== seq);
  if (pending.length === sync.pending.length) return sync;
  const confirmed = applyCommand(sync.confirmed, final);
  return withView({ ...sync, confirmed, pending, version: Math.max(sync.version, version) });
}

/** `nack`: o servidor recusou o comando `seq`; ele sai da tela. */
export function rejectCommand(sync: SyncState, seq: number): SyncState {
  const pending = sync.pending.filter((p) => p.seq !== seq);
  if (pending.length === sync.pending.length) return sync;
  return withView({ ...sync, pending });
}

/** Comando de outra pessoa (ou do próprio servidor, como o resultado de uma rolagem). */
export function remoteCommand(sync: SyncState, command: TableCommand, version: number): SyncState {
  const confirmed = applyCommand(sync.confirmed, command);
  return withView({ ...sync, confirmed, version: Math.max(sync.version, version) });
}

/** Estado completo (projeção do jogador ou resposta a `sync`): substitui o confirmado. */
export function replaceState(sync: SyncState, state: TableState, version: number): SyncState {
  return withView({ ...sync, confirmed: state, version });
}

// --- Rajadas (arrastar, WASD, memória da névoa) ---------------------------

/**
 * Comandos de valor absoluto que chegam em rajada (um por quadro) e podem ir ao servidor
 * agrupados: só o último valor importa. Mesma chave = mesma rajada; null = enviar na hora.
 */
export function burstKey(command: TableCommand): string | null {
  switch (command.type) {
    case 'moveToken':
    case 'moveTokens':
      return 'move';
    case 'setExplored':
      return `explored:${command.payload.sceneId}`;
    // Controle deslizante: um comando por movimento estouraria o limite de mensagens do servidor
    case 'setSoundMaster':
      return 'soundMaster';
    case 'updateEntry': {
      const fields = Object.keys(command.payload.patch);
      return fields.length === 1 && fields[0] === 'volume' ? `volume:${command.payload.entryId}` : null;
    }
    default:
      return null;
  }
}

/** Junta uma rajada num comando só: movimentos viram um `moveTokens` com a última posição de cada token. */
export function mergeBurst(commands: readonly TableCommand[]): TableCommand {
  const last = commands[commands.length - 1];
  if (last.type !== 'moveToken' && last.type !== 'moveTokens') return last;
  const moves = new Map<string, { placementId: string; x: number; y: number }>();
  for (const c of commands) {
    const list = c.type === 'moveToken' ? [c.payload] : c.type === 'moveTokens' ? c.payload.moves : [];
    for (const m of list) {
      moves.delete(m.placementId);
      moves.set(m.placementId, { placementId: m.placementId, x: m.x, y: m.y });
    }
  }
  return { type: 'moveTokens', payload: { moves: [...moves.values()] } };
}

/**
 * Troca os pendentes da rajada (`seqs`) pelo comando agrupado `seq`, na posição do último deles
 * (os valores são absolutos: aplicar só o último dá a mesma tela).
 */
export function squashPending(sync: SyncState, seqs: readonly number[], seq: number, command: TableCommand): SyncState {
  const squashed = new Set(seqs);
  let lastIndex = -1;
  sync.pending.forEach((p, i) => {
    if (squashed.has(p.seq)) lastIndex = i;
  });
  if (lastIndex < 0) return sync;
  const pending = sync.pending.flatMap((p, i) => (i === lastIndex ? [{ seq, command }] : squashed.has(p.seq) ? [] : [p]));
  return withView({ ...sync, pending });
}

// --- Movimento suave dos outros ----------------------------------------------

/**
 * Tokens que esta tela está movendo agora (movimentos ainda sem resposta do servidor). Eles
 * acompanham o ponteiro/teclado sem atraso; os demais deslizam até cada posição recebida, para o
 * movimento dos outros (que chega em rajadas) não aparecer aos saltos.
 */
export function pendingMoveIds(sync: SyncState): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const { command } of sync.pending) {
    if (command.type === 'moveToken') ids.add(command.payload.placementId);
    else if (command.type === 'moveTokens') for (const m of command.payload.moves) ids.add(m.placementId);
  }
  return ids;
}

/** Recalcula a tela: confirmado + pendentes, na ordem em que foram feitos. */
function withView(sync: SyncState): SyncState {
  return { ...sync, view: sync.pending.reduce((s, p) => applyCommand(s, p.command), sync.confirmed) };
}
