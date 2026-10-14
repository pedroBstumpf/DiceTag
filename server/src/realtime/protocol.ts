import { z } from 'zod';
import type { TableRole, TableState } from '../domain';
import { idSchema as id } from '../lib/ids';
import { COMMAND_TYPES, rollConfig } from './command-schemas';

/**
 * Protocolo da sala da mesa (WebSocket em `/ws/tables/:id`). Mensagens JSON com o campo `t`.
 *
 * Cliente → servidor
 * - `cmd`   { seq, type, payload }  comando da mesa (o servidor valida, aplica e repassa);
 * - `roll`  { seq, sheetId?, roll, label, icon }  rolagem feita NO SERVIDOR;
 * - `event` { event }  evento efêmero (ping, efeito): repassado, não salvo;
 * - `sync`  {}  pede o estado completo de novo.
 *
 * Servidor → cliente
 * - `welcome` { you, version, state }  ao entrar (estado já projetado para quem olha);
 * - `ack`     { seq, version, type, payload }  comando aceito (payload final, carimbado);
 * - `nack`    { seq, reason }  comando recusado (o cliente desfaz a previsão local);
 * - `cmd`     { version, type, payload, by }  comando de outra pessoa (só para o mestre);
 * - `state`   { version, state }  estado projetado (jogadores, após mudanças; ou após `sync`);
 * - `event`   { event, by }  evento efêmero de outra pessoa;
 * - `error`   { code, message }  mensagem inválida, limite de taxa…
 *
 * `seq` é o número que o cliente dá a cada envio, para casar `ack`/`nack` com o pedido.
 */

const seq = z.int().min(0).max(2 ** 31 - 1);
const coord = z.number().min(-1e6).max(1e6);
const point = z.strictObject({ x: coord, y: coord });

const eventSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ping'), sceneId: id, x: coord, y: coord }),
  z.strictObject({
    kind: z.literal('fx'),
    sceneId: id,
    fx: z.strictObject({
      kind: z.string().max(40),
      color: z.string().regex(/^#[0-9a-fA-F]{3,8}$/),
      from: point,
      to: point,
      seed: z.number().min(0).max(2 ** 53),
      scale: z.number().positive().max(1000),
      level: z.int().min(0).max(10).optional(),
    }),
  }),
]);

export const clientMessage = z.discriminatedUnion('t', [
  z.strictObject({ t: z.literal('cmd'), seq, type: z.enum(COMMAND_TYPES), payload: z.unknown() }),
  z.strictObject({
    t: z.literal('roll'),
    seq,
    sheetId: z.string().max(80).optional(),
    roll: rollConfig,
    label: z.string().max(80),
    icon: z.string().max(40),
  }),
  z.strictObject({ t: z.literal('event'), event: eventSchema }),
  z.strictObject({ t: z.literal('sync') }),
]);

export type ClientMessage = z.infer<typeof clientMessage>;
export type TableEvent = z.infer<typeof eventSchema>;

export type ServerMessage =
  | { t: 'welcome'; tableId: string; you: { userId: string; name: string; role: TableRole }; version: number; state: TableState }
  | { t: 'ack'; seq: number; version: number; type: string; payload: unknown }
  | { t: 'nack'; seq: number; reason: string }
  | { t: 'cmd'; version: number; type: string; payload: unknown; by: string }
  | { t: 'state'; version: number; state: TableState }
  | { t: 'event'; event: TableEvent; by: string }
  | { t: 'error'; code: string; message: string };

/** Códigos de fechamento próprios (4000–4999 são livres para a aplicação). */
export const CLOSE = {
  unauthorized: 4401,
  forbidden: 4403,
  tableDeleted: 4404,
  policy: 1008,
  tooBig: 1009,
  goingAway: 1001,
} as const;
