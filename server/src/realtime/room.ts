import type { WebSocket } from 'ws';
import { applyCommand, normalizeState, type TableCommand, type TableRole, type TableState } from '../domain';
import type { TokenBucket } from '../lib/limiter';
import { COMMAND_RULES, type RuleResult } from './command-rules';
import { COMMAND_SCHEMAS } from './command-schemas';
import { projectState } from './projection';
import type { ServerMessage } from './protocol';

/** Uma conexão de um usuário na sala. */
export interface Client {
  ws: WebSocket;
  userId: string;
  userName: string;
  role: TableRole;
  /** Hash do token da sessão: a conexão cai se a sessão for encerrada (logout, troca de senha). */
  tokenHash: string;
  ip: string;
  messages: TokenBucket;
  events: TokenBucket;
  /** Respondeu ao último ping? */
  alive: boolean;
  /** Mensagens inválidas/acima do limite seguidas (muitas = conexão fechada). */
  strikes: number;
}

/** Estado serializado acima disto: a mesa para de aceitar comandos que acrescentam dados. */
export const MAX_STATE_BYTES = 20 * 1024 * 1024;
/** Mensagens na fila de envio acima disto: cliente lento demais, conexão derrubada. */
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;
const SAVE_DEBOUNCE_MS = 500;
const PLAYER_SYNC_MS = 30;

export interface RoomStore {
  load(tableId: string): { state: unknown; version: number } | null;
  save(tableId: string, json: string, version: number): void;
}

/**
 * Sala de uma mesa aberta: o estado oficial em memória, a versão e as conexões.
 *
 * Fluxo de um comando (SPEC.md §1): validar formato → autorizar → aplicar a MESMA função pura
 * do front-end (`applyCommand`) → versão + 1 → gravar (agrupado, 500 ms) → avisar:
 * - quem enviou recebe `ack` com o payload final;
 * - o mestre recebe o comando (`cmd`), pois vê tudo;
 * - jogadores recebem o estado projetado (`state`), agrupado em 30 ms: assim nunca recebem um
 *   comando com algo que não podem ver (ex.: anotação secreta criada pelo mestre).
 */
export class Room {
  readonly clients = new Set<Client>();
  private state: TableState;
  private version: number;
  private full = false;
  private saveTimer: NodeJS.Timeout | null = null;
  private syncTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(
    readonly tableId: string,
    private readonly store: RoomStore,
    private readonly onError: (err: unknown) => void,
    private readonly now: () => number = Date.now,
  ) {
    const saved = store.load(tableId);
    this.state = normalizeState(saved?.state as TableState | undefined);
    this.version = saved?.version ?? 0;
    this.full = JSON.stringify(this.state).length > MAX_STATE_BYTES;
  }

  get snapshot(): { state: TableState; version: number } {
    return { state: this.state, version: this.version };
  }

  // --- Comandos ----------------------------------------------------------------

  /** Comando vindo de um cliente: valida, autoriza, aplica e avisa a sala. */
  handleCommand(client: Client, seq: number, type: TableCommand['type'], rawPayload: unknown): void {
    const parsed = COMMAND_SCHEMAS[type].safeParse(rawPayload);
    if (!parsed.success) return this.send(client, { t: 'nack', seq, reason: 'Dados do comando inválidos.' });
    const rule = COMMAND_RULES[type] as (p: unknown, ctx: Parameters<(typeof COMMAND_RULES)[typeof type]>[1]) => RuleResult<unknown>;
    const verdict = rule(parsed.data, {
      state: this.state,
      viewer: { role: client.role, userId: client.userId },
      userName: client.userName,
      now: this.now(),
      full: this.full,
    });
    if (!verdict.ok) return this.send(client, { t: 'nack', seq, reason: verdict.reason });
    const command = { type, payload: verdict.payload } as TableCommand;
    this.apply(command, client.userId, client);
    this.send(client, { t: 'ack', seq, version: this.version, type, payload: command.payload });
  }

  /**
   * Aplica um comando já autorizado (do cliente, depois das regras, ou do próprio servidor:
   * gasto de Mana, mensagem de rolagem). Comando sem efeito não muda a versão.
   * `origin`: conexão que enviou (recebe o `ack`, não o eco do comando).
   */
  apply(command: TableCommand, by: string, origin?: Client): boolean {
    const next = applyCommand(this.state, command);
    if (next === this.state) return false;
    this.state = next;
    this.version++;
    this.scheduleSave();
    for (const c of this.clients) {
      if (c.role === 'gm' && c !== origin) this.send(c, { t: 'cmd', version: this.version, type: command.type, payload: command.payload, by });
    }
    this.schedulePlayerSync();
    return true;
  }

  /** Estado projetado para um cliente (entrada na sala e `sync`). */
  stateFor(client: Client): TableState {
    return projectState(this.state, { role: client.role, userId: client.userId });
  }

  // --- Envio ---------------------------------------------------------------------

  send(client: Client, message: ServerMessage): void {
    if (client.ws.readyState !== client.ws.OPEN) return;
    // Cliente que não consome as mensagens (rede lenta ou de propósito) não pode encher a memória
    if (client.ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      client.ws.terminate();
      return;
    }
    client.ws.send(JSON.stringify(message));
  }

  broadcast(message: ServerMessage, except?: Client): void {
    for (const c of this.clients) if (c !== except) this.send(c, message);
  }

  /** Jogadores recebem o estado projetado; mudanças em sequência viram um envio só. */
  private schedulePlayerSync(): void {
    if (this.syncTimer || this.closed) return;
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      // Mesma conta em várias abas: projeta uma vez por conta
      const cache = new Map<string, string>();
      for (const c of this.clients) {
        if (c.role === 'gm') continue;
        let json = cache.get(c.userId);
        if (!json) {
          json = JSON.stringify({ t: 'state', version: this.version, state: this.stateFor(c) } satisfies ServerMessage);
          cache.set(c.userId, json);
        }
        if (c.ws.readyState === c.ws.OPEN && c.ws.bufferedAmount <= MAX_BUFFERED_BYTES) c.ws.send(json);
      }
    }, PLAYER_SYNC_MS);
  }

  // --- Persistência ----------------------------------------------------------------

  private scheduleSave(): void {
    if (this.saveTimer || this.closed) return;
    this.saveTimer = setTimeout(() => this.flush(), SAVE_DEBOUNCE_MS);
  }

  /** Grava agora o que estiver pendente. */
  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (this.closed) return;
    try {
      const json = JSON.stringify(this.state);
      this.full = json.length > MAX_STATE_BYTES;
      this.store.save(this.tableId, json, this.version);
    } catch (err) {
      this.onError(err);
    }
  }

  /** Fecha a sala. `save: false` quando a mesa foi excluída (não há mais onde gravar). */
  close(save: boolean): void {
    if (save) this.flush();
    this.closed = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.syncTimer) clearTimeout(this.syncTimer);
  }
}
