import { Point } from '../../../core/models/geometry.model';
import { RollConfig, TableRole, TableState } from '../../../core/models/table-session.model';
import { TableCommandType } from '../state/commands';

/** Quem está conectado, segundo o servidor (o papel vem da conta: dono = mestre). */
export interface RoomIdentity {
  userId: string;
  name: string;
  role: TableRole;
}

/** Situação da conexão com a sala, mostrada na barra da mesa. */
export type RoomStatus = 'connecting' | 'online' | 'offline';

/**
 * Mensagens do servidor (espelho de `server/src/realtime/protocol.ts`; o front não importa do
 * servidor). `vision`: polígonos de visão do jogador com névoa (null para o mestre ou sem névoa).
 */
export type RoomMessage =
  | { t: 'welcome'; tableId: string; you: RoomIdentity; version: number; state: TableState; vision: Point[][] | null }
  | { t: 'ack'; seq: number; version: number; type: TableCommandType | 'roll'; payload: unknown }
  | { t: 'nack'; seq: number; reason: string }
  | { t: 'cmd'; version: number; type: TableCommandType; payload: unknown; by: string }
  | { t: 'state'; version: number; state: TableState; vision: Point[][] | null }
  | { t: 'event'; event: unknown; by: string }
  | { t: 'world' }
  | { t: 'error'; code: string; message: string };

/** Pedido de rolagem: o servidor sorteia, recalcula as tags com a ficha atual e grava no chat. */
export interface RoomRoll {
  sheetId?: string;
  roll: RollConfig;
  label: string;
  icon: string;
}

/** Fechamentos definitivos (não adianta reconectar), com o motivo para a tela. */
const FINAL_CLOSE: Record<number, string> = {
  4401: 'Sua sessão no servidor terminou. Entre de novo em Minhas mesas.',
  4403: 'Você não participa mais desta mesa.',
  4404: 'A mesa foi excluída.',
};
/** Tentativas de reconexão antes de desistir (espera dobra a cada uma: 1 s, 2 s, 4 s…). */
const MAX_RETRIES = 5;

/**
 * Conexão WebSocket com a sala de uma mesa online (`/ws/tables/:id`, repassado pelo `ng serve`).
 *
 * Só transporte: abre, reconecta se cair (até `MAX_RETRIES` vezes), entrega cada mensagem do
 * servidor ao `onMessage` e numera os envios (`seq`) para casar com `ack`/`nack`. O que fazer com
 * as mensagens é do `TableSessionService`. Sem Angular: o cookie de sessão vai sozinho (mesma origem).
 */
export class TableRoom {
  private ws: WebSocket | null = null;
  private seq = 0;
  private retries = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private closed = false;

  constructor(
    private readonly tableId: string,
    private readonly onMessage: (message: RoomMessage) => void,
    private readonly onStatus: (status: RoomStatus, reason?: string) => void,
  ) {
    this.open();
  }

  /** Próximo número de envio. */
  nextSeq(): number {
    return ++this.seq;
  }

  /** Envia um comando da mesa. false = sem conexão agora (a tela recebe o estado de novo ao reconectar). */
  sendCommand(seq: number, type: TableCommandType, payload: unknown): boolean {
    return this.send({ t: 'cmd', seq, type, payload });
  }

  sendRoll(seq: number, roll: RoomRoll): boolean {
    return this.send({ t: 'roll', seq, ...roll });
  }

  /** Pede o estado completo de novo (ex.: depois de um comando recusado). */
  sync(): void {
    this.send({ t: 'sync' });
  }

  /** Fecha de vez (ao sair da mesa). */
  close(): void {
    this.closed = true;
    clearTimeout(this.retryTimer);
    this.ws?.close(1000);
    this.ws = null;
  }

  // --- Internos ------------------------------------------------------------

  private open(): void {
    this.onStatus('connecting');
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${scheme}://${location.host}/ws/tables/${encodeURIComponent(this.tableId)}`);
    this.ws = ws;
    ws.onmessage = (event) => {
      let message: RoomMessage;
      try {
        message = JSON.parse(String(event.data)) as RoomMessage;
      } catch {
        return;
      }
      if (message.t === 'welcome') {
        this.retries = 0;
        this.onStatus('online');
      }
      this.onMessage(message);
    };
    ws.onclose = (event) => {
      if (this.closed || this.ws !== ws) return;
      this.ws = null;
      const final = FINAL_CLOSE[event.code];
      if (final) return this.onStatus('offline', final);
      if (this.retries >= MAX_RETRIES) return this.onStatus('offline', 'Sem conexão com o servidor. Recarregue a página para tentar de novo.');
      this.onStatus('connecting');
      this.retryTimer = setTimeout(() => this.open(), 1000 * 2 ** this.retries++);
    };
  }

  private send(message: object): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(message));
    return true;
  }
}
