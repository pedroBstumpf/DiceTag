import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { FastifyBaseLogger } from 'fastify';
import { WebSocketServer, type RawData } from 'ws';
import type { AppContext } from '../context';
import { normalizeState, type TableState } from '../domain';
import { newId, isSafeId } from '../lib/ids';
import { TokenBucket, WindowLimiter } from '../lib/limiter';
import { parseJsonSafely, unsafeJsonReason } from '../lib/safe-json';
import { readCookie, sessionCookieName } from '../security/cookie';
import { isAllowedOrigin } from '../security/origin';
import { CLOSE, clientMessage, type ClientMessage } from './protocol';
import { Room, type Client } from './room';
import { performRoll } from './rolls';

/** Tamanho máximo de uma mensagem recebida (o `ws` fecha a conexão acima disto). */
const MAX_MESSAGE_BYTES = 512 * 1024;
/** Intervalo do ping de verificação (conexões mortas caem em até 2 intervalos). */
const HEARTBEAT_MS = 30_000;
const MAX_SOCKETS_PER_USER = 8;
const MAX_SOCKETS_PER_ROOM = 80;
/** Mensagens inválidas ou acima do limite antes de derrubar a conexão. */
const MAX_STRIKES = 20;
const WS_PATH = /^\/ws\/tables\/([A-Za-z0-9_-]{1,64})$/;

/**
 * Servidor WebSocket das mesas (biblioteca `ws`), acoplado ao servidor HTTP do Fastify.
 *
 * Antes de aceitar a conexão (no "upgrade" HTTP), recusa sem abrir o socket se:
 * - o caminho não é `/ws/tables/<id>`;
 * - a origem não está em ALLOWED_ORIGINS (CSWSH: outro site abrindo o socket com o cookie da vítima);
 * - passou do limite de tentativas por IP;
 * - não há sessão válida (cookie) ou a conta não é membro da mesa;
 * - a conta ou a sala já têm conexões demais.
 *
 * Depois de aberta: mensagens só de texto, até 512 KB, JSON seguro e validado; limite de taxa
 * por conexão; ping a cada 30 s (conexão morta cai); a cada ping, confere de novo se a sessão
 * e a participação na mesa continuam válidas (logout ou expulsão derrubam a conexão).
 * Sem compressão (`perMessageDeflate: false`): evita "bombas" de descompressão e custo de CPU.
 */
export class RealtimeHub {
  private readonly wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_BYTES,
    perMessageDeflate: false,
    clientTracking: false,
  });
  private readonly rooms = new Map<string, Room>();
  private readonly socketsByUser = new Map<string, number>();
  private readonly upgradesByIp = new WindowLimiter(30, 60_000);
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(
    private readonly ctx: AppContext,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** Liga o WebSocket ao servidor HTTP. */
  attach(server: Server): void {
    server.on('upgrade', (req, socket, head) => this.handleUpgrade(req, socket, head));
    this.heartbeat = setInterval(() => this.checkConnections(), HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  // --- Abertura da conexão ---------------------------------------------------------

  private handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    socket.on('error', () => socket.destroy());
    const reject = (status: number, text: string) => {
      socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    };
    const tableId = WS_PATH.exec(new URL(req.url ?? '/', 'http://localhost').pathname)?.[1];
    if (!tableId || !isSafeId(tableId)) return reject(404, 'Not Found');
    if (!isAllowedOrigin(req.headers, this.ctx.config.allowedOrigins)) return reject(403, 'Forbidden');
    const ip = this.ipOf(req);
    if (this.ctx.config.RATE_LIMIT && !this.upgradesByIp.hit(ip)) return reject(429, 'Too Many Requests');

    const session = this.ctx.auth.resolve(readCookie(req.headers.cookie, sessionCookieName(this.ctx.config)));
    if (!session) return reject(401, 'Unauthorized');
    const role = this.ctx.tables.roleOf(tableId, session.user.id);
    // Mesa de outra pessoa ou inexistente: mesma resposta (não revela que a mesa existe)
    if (!role) return reject(404, 'Not Found');
    if ((this.socketsByUser.get(session.user.id) ?? 0) >= MAX_SOCKETS_PER_USER) return reject(429, 'Too Many Requests');
    if ((this.rooms.get(tableId)?.clients.size ?? 0) >= MAX_SOCKETS_PER_ROOM) return reject(503, 'Service Unavailable');

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      const client: Client = {
        ws,
        userId: session.user.id,
        userName: session.user.name,
        role,
        tokenHash: session.tokenHash,
        ip,
        messages: new TokenBucket(20, 60),
        events: new TokenBucket(5, 15),
        alive: true,
        strikes: 0,
      };
      this.join(tableId, client);
    });
  }

  private join(tableId: string, client: Client): void {
    const room = this.roomOf(tableId);
    room.clients.add(client);
    this.socketsByUser.set(client.userId, (this.socketsByUser.get(client.userId) ?? 0) + 1);
    const { ws } = client;
    ws.on('pong', () => (client.alive = true));
    ws.on('message', (data, isBinary) => this.handleMessage(room, client, data, isBinary));
    ws.on('close', () => this.leave(room, client));
    ws.on('error', (err) => this.log.warn({ err: err.message, tableId }, 'erro no WebSocket'));
    room.send(client, {
      t: 'welcome',
      tableId,
      you: { userId: client.userId, name: client.userName, role: client.role },
      version: room.snapshot.version,
      state: room.stateFor(client),
    });
    this.log.info({ tableId, userId: client.userId, role: client.role }, 'entrou na mesa');
  }

  private leave(room: Room, client: Client): void {
    if (!room.clients.delete(client)) return;
    const count = (this.socketsByUser.get(client.userId) ?? 1) - 1;
    if (count > 0) this.socketsByUser.set(client.userId, count);
    else this.socketsByUser.delete(client.userId);
    // Último a sair: grava e libera a memória da sala
    if (!room.clients.size) {
      room.close(true);
      if (this.rooms.get(room.tableId) === room) this.rooms.delete(room.tableId);
    }
  }

  // --- Mensagens -------------------------------------------------------------------

  private handleMessage(room: Room, client: Client, data: RawData, isBinary: boolean): void {
    if (isBinary) return client.ws.close(CLOSE.policy, 'Somente texto.');
    if (!client.messages.take()) return this.strike(room, client, 'rate', 'Mensagens demais. Aguarde um pouco.');

    let raw: unknown;
    try {
      raw = parseJsonSafely(data.toString());
    } catch {
      return this.strike(room, client, 'invalid', 'Mensagem inválida.');
    }
    const unsafe = unsafeJsonReason(raw);
    if (unsafe) return this.strike(room, client, 'invalid', `Mensagem recusada: ${unsafe}.`);
    const parsed = clientMessage.safeParse(raw);
    if (!parsed.success) return this.strike(room, client, 'invalid', 'Formato de mensagem desconhecido.');
    client.strikes = 0;

    try {
      this.dispatch(room, client, parsed.data);
    } catch (err) {
      // Nunca derruba o servidor por causa de uma mensagem; o detalhe fica só no log
      this.log.error({ err, tableId: room.tableId }, 'erro ao processar mensagem');
      room.send(client, { t: 'error', code: 'internal', message: 'Erro interno.' });
    }
  }

  private dispatch(room: Room, client: Client, msg: ClientMessage): void {
    switch (msg.t) {
      case 'cmd':
        return room.handleCommand(client, msg.seq, msg.type, msg.payload);
      case 'roll': {
        const viewer = { role: client.role, userId: client.userId };
        const result = performRoll(room.snapshot.state, msg, viewer, client.userName, Date.now(), newId());
        if (!result.ok) return room.send(client, { t: 'nack', seq: msg.seq, reason: result.reason });
        for (const command of result.commands) room.apply(command, client.userId);
        return room.send(client, { t: 'ack', seq: msg.seq, version: room.snapshot.version, type: 'roll', payload: result.message });
      }
      case 'event':
        if (!client.events.take()) return room.send(client, { t: 'error', code: 'rate', message: 'Eventos demais.' });
        // Jogador só envia eventos na cena aberta (é a única que ele vê)
        if (client.role !== 'gm' && msg.event.sceneId !== room.snapshot.state.activeSceneId) return;
        return room.broadcast({ t: 'event', event: msg.event, by: client.userId }, client);
      case 'sync':
        return room.send(client, { t: 'state', version: room.snapshot.version, state: room.stateFor(client) });
    }
  }

  private strike(room: Room, client: Client, code: string, message: string): void {
    room.send(client, { t: 'error', code, message });
    if (++client.strikes >= MAX_STRIKES) client.ws.close(CLOSE.policy, 'Mensagens inválidas demais.');
  }

  // --- Verificação periódica --------------------------------------------------------

  /** Ping nas conexões; derruba as mortas e as de sessões encerradas ou contas expulsas. */
  private checkConnections(): void {
    for (const room of this.rooms.values()) {
      for (const client of room.clients) {
        if (!client.alive) {
          client.ws.terminate();
          continue;
        }
        if (!this.ctx.auth.stillValid(client.tokenHash)) {
          client.ws.close(CLOSE.unauthorized, 'Sessão encerrada.');
          continue;
        }
        if (this.ctx.tables.roleOf(room.tableId, client.userId) !== client.role) {
          client.ws.close(CLOSE.forbidden, 'Você não participa mais desta mesa.');
          continue;
        }
        client.alive = false;
        client.ws.ping();
      }
    }
  }

  // --- Usado pelas rotas HTTP ---------------------------------------------------------

  /** Estado atual da mesa: o da sala aberta ou o salvo. */
  stateOf(tableId: string): TableState {
    const room = this.rooms.get(tableId);
    return room ? room.snapshot.state : normalizeState(this.ctx.tables.loadState(tableId)?.state as TableState | undefined);
  }

  /** Expulsa a conta da sala (saiu ou foi removida da mesa). */
  kick(tableId: string, userId: string): void {
    for (const client of this.rooms.get(tableId)?.clients ?? []) {
      if (client.userId === userId) client.ws.close(CLOSE.forbidden, 'Você não participa mais desta mesa.');
    }
  }

  /** A mesa foi excluída: fecha as conexões sem gravar. */
  closeRoom(tableId: string): void {
    const room = this.rooms.get(tableId);
    if (!room) return;
    room.close(false);
    this.rooms.delete(tableId);
    for (const client of room.clients) client.ws.close(CLOSE.tableDeleted, 'A mesa foi excluída.');
  }

  /** Desligamento do servidor: grava todas as salas e fecha as conexões. */
  shutdown(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    const clients = [...this.rooms.values()].flatMap((room) => {
      room.close(true);
      return [...room.clients];
    });
    for (const client of clients) client.ws.close(CLOSE.goingAway, 'Servidor reiniciando.');
    // Quem não responder ao fechamento em 2 s é derrubado
    setTimeout(() => clients.forEach((c) => c.ws.terminate()), 2000).unref();
    this.rooms.clear();
    this.wss.close();
  }

  // --- Auxiliares -----------------------------------------------------------------------

  private get store() {
    return {
      load: (tableId: string) => this.ctx.tables.loadState(tableId),
      save: (tableId: string, json: string, version: number) => this.ctx.tables.saveState(tableId, json, version, Date.now()),
    };
  }

  private roomOf(tableId: string): Room {
    let room = this.rooms.get(tableId);
    if (!room) {
      room = new Room(tableId, this.store, (err) => this.log.error({ err, tableId }, 'erro ao gravar a mesa'));
      this.rooms.set(tableId, room);
    }
    return room;
  }

  /** IP de quem conecta (com proxy confiável, o primeiro do X-Forwarded-For). */
  private ipOf(req: IncomingMessage): string {
    if (this.ctx.config.TRUST_PROXY) {
      const forwarded = req.headers['x-forwarded-for'];
      const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
      if (first) return first;
    }
    return req.socket.remoteAddress ?? 'desconhecido';
  }
}

