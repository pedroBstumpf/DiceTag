import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { transaction } from '../../db/database';
import { TABLE_ACCENTS, type TableRole, type WorldItem } from '../../domain';
import { conflict, forbidden, HttpError, notFound, parse } from '../../lib/errors';
import { idSchema, newId } from '../../lib/ids';
import { multilineText, text } from '../../lib/schemas';
import type { MemberTable, TableRecord } from '../../repositories/tables';
import type { RealtimeHub } from '../../realtime/hub';
import { projectLore } from '../../realtime/projection';
import { requireAuth } from '../plugins/auth';
import { AUTH_RATE_LIMIT } from '../plugins/security';

const tableFields = {
  name: text(1, 60),
  system: text(0, 60),
  description: multilineText(400),
  maxPlayers: z.int().min(1).max(20),
  accent: z.enum(TABLE_ACCENTS),
};
const createBody = z.strictObject({ ...tableFields, worldId: idSchema.optional() });
const updateBody = z.strictObject(tableFields).partial();
// Parâmetros vêm do roteador (rotas aninhadas trazem outros): valida só os usados
const idParams = z.object({ id: idSchema });
const memberParams = z.object({ id: idSchema, userId: idSchema });
const acceptBody = z.strictObject({ code: z.string().min(10).max(100).regex(/^[A-Za-z0-9_-]+$/) });

/** Validade dos convites. */
const INVITE_TTL_MS = 7 * 24 * 3_600_000;

/**
 * /api/tables e /api/invites — mesas, membros, convites e a Lore da mesa.
 *
 * Autorização: toda rota confere a participação da conta na mesa. Mesa de outra conta responde
 * 404 (igual a inexistente: não revela que existe). Ações do mestre exigem o papel `gm`.
 */
export async function tableRoutes(app: FastifyInstance, ctx: AppContext, hub: RealtimeHub): Promise<void> {
  /** Mesa + papel da conta nela, numa consulta só (404 se não existe ou não participa). */
  const access = (req: FastifyRequest): { table: MemberTable; role: TableRole; userId: string } => {
    const { user } = requireAuth(req);
    const { id } = parse(idParams, req.params);
    const table = ctx.tables.findForMember(id, user.id);
    if (!table) throw notFound('Mesa não encontrada.');
    return { table, role: table.role, userId: user.id };
  };
  const gmAccess = (req: FastifyRequest) => {
    const found = access(req);
    if (found.role !== 'gm') throw forbidden('Só o mestre pode fazer isso.');
    return found;
  };

  // --- Mesas -----------------------------------------------------------------

  app.get('/tables', async (req) => ({ tables: ctx.tables.listForUser(requireAuth(req).user.id) }));

  app.post('/tables', async (req, reply) => {
    const { user } = requireAuth(req);
    const body = parse(createBody, req.body);
    const worlds = ctx.worlds.listByOwner(user.id);
    const world = body.worldId ? worlds.find((w) => w.id === body.worldId) : worlds[0];
    if (!world) throw notFound('Mundo não encontrado.');
    const table: TableRecord = { ...body, id: newId(), ownerId: user.id, worldId: world.id, createdAt: Date.now() };
    ctx.tables.create(table);
    return reply.code(201).send({ table: { ...table, role: 'gm' } });
  });

  app.get('/tables/:id', async (req) => ({ table: access(req).table }));

  app.patch('/tables/:id', async (req) => {
    const { table, userId } = gmAccess(req);
    const patch = parse(updateBody, req.body);
    if (patch.maxPlayers !== undefined && patch.maxPlayers < ctx.tables.playerCount(table.id)) {
      throw conflict('A mesa já tem mais jogadores que esse limite.');
    }
    if (!ctx.tables.update(table.id, userId, patch)) throw forbidden('Só o mestre pode fazer isso.');
    return { table: ctx.tables.findForMember(table.id, userId) };
  });

  /** Excluir: só o dono. Apaga estado, membros, convites e os arquivos da mesa. */
  app.delete('/tables/:id', async (req, reply) => {
    const { table, userId } = access(req);
    const fileIds = ctx.files.idsByTable(table.id);
    if (!ctx.tables.delete(table.id, userId)) throw forbidden('Só o dono pode excluir a mesa.');
    hub.closeRoom(table.id);
    await ctx.files.delete(fileIds);
    return reply.code(204).send();
  });

  // --- Membros ---------------------------------------------------------------

  app.get('/tables/:id/members', async (req) => {
    const { table, userId } = access(req);
    return { members: ctx.tables.members(table.id, userId) };
  });

  /** Mestre remove um jogador; jogador sai sozinho. O dono não sai da própria mesa. */
  app.delete('/tables/:id/members/:userId', async (req, reply) => {
    const { table, role, userId } = access(req);
    const target = parse(memberParams, req.params).userId;
    if (target === table.ownerId) throw forbidden('O dono não pode sair da própria mesa.');
    if (role !== 'gm' && target !== userId) throw forbidden('Só o mestre pode remover jogadores.');
    // A consulta só apaga jogadores: o mestre nunca sai por aqui
    if (ctx.tables.removePlayer(table.id, target)) hub.kick(table.id, target);
    return reply.code(204).send();
  });

  // --- Convites --------------------------------------------------------------

  /** Gera um código de convite (mostrado UMA vez; o banco guarda só o hash). */
  app.post('/tables/:id/invites', async (req, reply) => {
    const { table, userId } = gmAccess(req);
    const code = ctx.tokens.generate(24);
    const now = Date.now();
    const expiresAt = now + INVITE_TTL_MS;
    if (!ctx.tables.createInvite(ctx.tokens.hash(code, 'invite'), table.id, userId, now, expiresAt, table.maxPlayers)) {
      throw forbidden('Só o mestre pode fazer isso.');
    }
    return reply.code(201).send({ code, expiresAt });
  });

  /** Cancela todos os convites da mesa. */
  app.delete('/tables/:id/invites', async (req, reply) => {
    const { table, userId } = gmAccess(req);
    ctx.tables.revokeInvites(table.id, userId);
    return reply.code(204).send();
  });

  /** Entra numa mesa com um código de convite (como jogador). */
  app.post('/invites/accept', { config: AUTH_RATE_LIMIT }, async (req) => {
    const { user } = requireAuth(req);
    const { code } = parse(acceptBody, req.body);
    const codeHash = ctx.tokens.hash(code, 'invite');
    const tableId = transaction(ctx.db, () => {
      const invite = ctx.tables.findInvite(codeHash);
      // Mesma resposta para código inexistente, vencido ou esgotado
      if (!invite || invite.expiresAt <= Date.now() || invite.uses >= invite.maxUses) throw new HttpError(404, 'Convite inválido ou vencido.');
      const table = ctx.tables.find(invite.tableId);
      if (!table) throw new HttpError(404, 'Convite inválido ou vencido.');
      if (ctx.tables.roleOf(table.id, user.id)) return table.id;
      if (ctx.tables.playerCount(table.id) >= table.maxPlayers) throw conflict('A mesa está cheia.');
      ctx.tables.addMember(table.id, user.id, 'player', Date.now());
      ctx.tables.useInvite(codeHash);
      return table.id;
    });
    return { table: ctx.tables.findForMember(tableId, user.id) };
  });

  // --- Lore da mesa ------------------------------------------------------------

  /** Itens do mundo da mesa: o mestre vê todos; o jogador, só os revelados nesta mesa. */
  app.get('/tables/:id/lore', async (req) => {
    const { table, role, userId } = access(req);
    const items = ctx.worlds.listItemsForMember(table.id, userId) as WorldItem[];
    const viewer = { role, userId };
    // Estado já projetado: só os NPCs que a conta vê na mesa (ou controla) entram na Lore
    return { items: projectLore(items, hub.viewOf(table.id, table.worldId, viewer).state, viewer) };
  });
}
