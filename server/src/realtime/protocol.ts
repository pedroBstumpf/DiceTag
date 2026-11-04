import { z } from 'zod';
import type { Point, TableRole, TableState } from '../domain';
import { idSchema as id } from '../lib/ids';
import { COMMAND_TYPES, fxKindSchema, rollConfig } from './command-schemas';

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
 * - `welcome` { you, version, state, vision }  ao entrar (estado já projetado para quem olha);
 * - `ack`     { seq, version, type, payload }  comando aceito (payload final, carimbado);
 * - `nack`    { seq, reason }  comando recusado (o cliente desfaz a previsão local);
 * - `cmd`     { version, type, payload, by }  comando de outra pessoa (só para o mestre);
 * - `state`   { version, state, vision }  estado projetado (jogadores, quando a visão deles muda; ou após `sync`);
 * - `event`   { event, by }  evento efêmero de outra pessoa (só se ela pode vê-lo);
 * - `world`   {}  o Worldbuild da mesa mudou: o jogador busca de novo o que pode ver (`/tables/:id/lore`);
 * - `error`   { code, message }  mensagem inválida, limite de taxa…
 *
 * `vision`: polígonos de visão da cena aberta, calculados pelo servidor (jogador com névoa; null
 * para o mestre ou sem névoa). Com névoa, o jogador não recebe as paredes, só as portas vistas.
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
      // Só os efeitos que existem: quem recebe monta o desenho a partir deste nome
      kind: fxKindSchema,
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
  | {
      t: 'welcome';
      tableId: string;
      you: { userId: string; name: string; role: TableRole };
      version: number;
      state: TableState;
      vision: Point[][] | null;
    }
  | { t: 'ack'; seq: number; version: number; type: string; payload: unknown }
  | { t: 'nack'; seq: number; reason: string }
  | { t: 'cmd'; version: number; type: string; payload: unknown; by: string }
  | { t: 'state'; version: number; state: TableState; vision: Point[][] | null }
  | { t: 'event'; event: TableEvent; by: string }
  | { t: 'world' }
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
