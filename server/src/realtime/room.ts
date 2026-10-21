import type { WebSocket } from 'ws';
import { applyCommand, normalizeState, type TableCommand, type TableRole, type TableState, type Viewer } from '../domain';
import type { TokenBucket } from '../lib/limiter';
import { COMMAND_RULES, type RuleResult } from './command-rules';
import { COMMAND_SCHEMAS } from './command-schemas';
import { eventVisibleTo, playerVision, projectState } from './projection';
import type { ServerMessage, TableEvent } from './protocol';
import { VisionCache, type PlayerScene } from './vision';
import type { WorldView } from './world';

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
  /** Jogador: último estado projetado enviado (estado igual não é reenviado). */
  lastState?: string;
}

/** Estado projetado para uma conta, como vai na mensagem `welcome`/`state`. */
export interface ClientView {
  state: TableState;
  vision: ReturnType<typeof playerVision>;
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

export interface RoomDeps {
  store: RoomStore;
  /** Mundo da mesa (bestiário, Raças): leitura síncrona com cache. */
  world: WorldView;
  onError: (err: unknown) => void;
  now?: () => number;
}

/**
 * Sala de uma mesa aberta: o estado oficial em memória, a versão e as conexões.
 *
 * Fluxo de um comando (SPEC.md §1): validar formato → autorizar → aplicar a MESMA função pura
 * do front-end (`applyCommand`) → versão + 1 → gravar (agrupado, 500 ms) → avisar:
 * - quem enviou recebe `ack` com o payload final;
 * - o mestre recebe o comando (`cmd`), pois vê tudo;
 * - jogadores recebem o estado projetado (`state`), agrupado em 30 ms e só se mudou para eles:
 *   assim nunca recebem um comando com algo que não podem ver (ex.: token sob a névoa).
 */
export class Room {
  readonly clients = new Set<Client>();
  readonly world: WorldView;
  private state: TableState;
  private version: number;
  private full = false;
  private saveTimer: NodeJS.Timeout | null = null;
  private syncTimer: NodeJS.Timeout | null = null;
  private closed = false;
  private readonly vision: VisionCache;
  /** Cena dos jogadores calculada para a versão atual (uma vez para todos). */
  private view: { version: number; scene: PlayerScene | null } | null = null;
  private readonly store: RoomStore;
  private readonly onError: (err: unknown) => void;
  private readonly now: () => number;

  constructor(
    readonly tableId: string,
    readonly worldId: string,
    deps: RoomDeps,
  ) {
    this.store = deps.store;
    this.world = deps.world;
    this.onError = deps.onError;
    this.now = deps.now ?? Date.now;
    this.vision = new VisionCache((entry) => this.world.tokenOf(entry));
    const saved = this.store.load(tableId);
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

  // --- O que cada um vê ---------------------------------------------------------------

  /** Cena aberta como os jogadores a veem (calculada uma vez por versão). */
  playerScene(): PlayerScene | null {
    if (this.view?.version !== this.version) this.view = { version: this.version, scene: this.vision.sceneOf(this.state) };
    return this.view.scene;
  }

  /** Estado projetado para uma conta (entrada na sala, `sync` e mudanças). */
  viewFor(viewer: Viewer): ClientView {
    const scene = viewer.role === 'gm' ? null : this.playerScene();
    return { state: projectState(this.state, viewer, scene), vision: playerVision(viewer, scene) };
  }

  /** O mundo mudou (ex.: visão do token padrão de um NPC): recalcula e reenvia aos jogadores. */
  worldChanged(): void {
    this.world.invalidate();
    this.vision.clear();
    this.view = null;
    this.schedulePlayerSync();
  }

  /** Evento efêmero (ping, efeito): repassado só a quem pode vê-lo. */
  broadcastEvent(event: TableEvent, from: Client): void {
    const message: ServerMessage = { t: 'event', event, by: from.userId };
    for (const c of this.clients) {
      if (c !== from && eventVisibleTo(event, c, c.role === 'gm' ? null : this.playerScene())) this.send(c, message);
    }
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

  /** Estado projetado completo para a conexão (entrada na sala e `sync`), sempre enviado. */
  sendState(client: Client, t: 'welcome' | 'state', you?: Extract<ServerMessage, { t: 'welcome' }>['you']): void {
    const view = this.viewFor(client);
    if (client.role !== 'gm') client.lastState = JSON.stringify(view);
    const message: ServerMessage =
      t === 'welcome' && you
        ? { t, tableId: this.tableId, you, version: this.version, ...view }
        : { t: 'state', version: this.version, ...view };
    this.send(client, message);
  }

  /**
   * Jogadores recebem o estado projetado; mudanças em sequência viram um envio só, e quem não
   * teve nada alterado na própria visão não recebe nada (ex.: o mestre mexendo em outra cena).
   */
  private schedulePlayerSync(): void {
    if (this.syncTimer || this.closed) return;
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      // Mesma conta em várias abas: projeta uma vez por conta
      const byUser = new Map<string, string>();
      for (const c of this.clients) {
        if (c.role === 'gm') continue;
        let view = byUser.get(c.userId);
        if (view === undefined) {
          view = JSON.stringify(this.viewFor(c));
          byUser.set(c.userId, view);
        }
        if (view === c.lastState || c.ws.readyState !== c.ws.OPEN || c.ws.bufferedAmount > MAX_BUFFERED_BYTES) continue;
        c.lastState = view;
        // Monta a mensagem sem serializar o estado de novo
        c.ws.send(`{"t":"state","version":${this.version},${view.slice(1)}`);
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
