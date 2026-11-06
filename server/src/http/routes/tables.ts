import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { transaction } from '../../db/database';
import { normalizeState, TABLE_ACCENTS, type TableRole, type TableState, type WorldItem } from '../../domain';
import { audit } from '../../lib/audit';
import { badRequest, conflict, forbidden, HttpError, notFound, parse } from '../../lib/errors';
import { idSchema, newId } from '../../lib/ids';
import { loginNameOf, validGuestName } from '../../lib/login-name';
import { unsafeJsonReason } from '../../lib/safe-json';
import { multilineText, newPassword, text } from '../../lib/schemas';
import type { MemberTable, TableRecord } from '../../repositories/tables';
import type { RealtimeHub } from '../../realtime/hub';
import { barSchema, entrySchema, sheetSchema, tagSchema } from '../../realtime/command-schemas';
import { projectLore } from '../../realtime/projection';
import { MAX_STATE_BYTES } from '../../realtime/room';
import { controlledNpcChange, type ControlledNpcPatch } from '../../realtime/sheet-rules';
import { PUBLIC, requireAuth, requireOwner, setSessionCookie } from '../plugins/auth';
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
const npcParams = z.object({ id: idSchema, itemId: idSchema });
/** O que quem controla um NPC do bestiário pode gravar nele (ver `controlledNpcChange`). */
const npcBody = z.strictObject({
  sheet: sheetSchema.optional(),
  bars: z.array(barSchema).max(20).optional(),
  tags: z.array(tagSchema).max(50).optional(),
  abilities: z.array(entrySchema).max(200).optional(),
});
/**
 * Estado de uma mesa trazida de uma cópia do navegador. Valida o que o servidor percorre ao abrir a
 * sala; o resto passa pelos limites de `safe-json`, como os itens do mundo. Só o dono do app envia.
 */
const withId = z.looseObject({ id: idSchema });
const importStateBody = z.strictObject({
  state: z.looseObject({
    activeSceneId: idSchema.nullable().optional(),
    scenes: z
      .array(
        z.looseObject({
          id: idSchema,
          tokens: z.array(withId).max(5000).optional(),
          walls: z.array(withId).max(20_000).optional(),
          drawings: z.array(withId).max(20_000).optional(),
          notes: z.array(withId).max(5000).optional(),
        }),
      )
      .max(1000),
    entries: z.array(z.looseObject({ id: idSchema, kind: z.enum(['character', 'npc', 'sound', 'automation']) })).max(10_000),
  }),
});
/** Uma mesa inteira tem muito mais nós e textos maiores (memória da névoa) que um comando. */
const IMPORT_JSON_LIMITS = { maxDepth: 32, maxNodes: 2_000_000, maxStringLength: 8_000_000 };

const inviteCode = z.string().min(10).max(100).regex(/^[A-Za-z0-9_-]+$/);
const acceptBody = z.strictObject({ code: inviteCode });
/** Entrar por convite: o código e, no convite novo, o nome que os outros vão ver e a senha da conta. */
const redeemBody = z.strictObject({ code: inviteCode, name: text(1, 40).optional(), password: newPassword.optional() });

/** Tamanho máximo de um NPC gravado por quem o controla (o mesmo dos itens do mundo). */
const MAX_NPC_BYTES = 2 * 1024 * 1024;
/** Validade dos convites. */
const INVITE_TTL_MS = 7 * 24 * 3_600_000;
/** Mesma resposta para código inexistente, vencido ou já usado (não revela qual é o caso). */
const INVITE_INVALID = 'Convite inválido, vencido ou já usado. Peça outro a quem te convidou.';

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

  /** Só o dono do app cria mesas; os demais entram nas dele por convite. */
  app.post('/tables', async (req, reply) => {
    const { user } = requireOwner(req);
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

  /**
   * Grava o estado de uma mesa trazida de uma cópia. Só o dono do app, só o mestre e só numa mesa
   * que ainda não foi usada: nunca sobrescreve uma partida.
   */
  app.put('/tables/:id/state', { bodyLimit: MAX_STATE_BYTES + 1024 }, async (req, reply) => {
    requireOwner(req);
    const { table } = gmAccess(req);
    const { state } = parse(importStateBody, req.body);
    const unsafe = unsafeJsonReason(state, IMPORT_JSON_LIMITS);
    if (unsafe) throw badRequest(`Mesa recusada: ${unsafe}.`);
    if (hub.isOpen(table.id) || ctx.tables.loadState(table.id)) throw conflict('Esta mesa já foi usada.');
    const json = JSON.stringify(normalizeState(state as unknown as TableState));
    if (json.length > MAX_STATE_BYTES) throw new HttpError(413, 'Mesa grande demais.');
    ctx.tables.saveState(table.id, json, 1, Date.now());
    audit(req.log, 'mesa.importada', { userId: table.ownerId, tableId: table.id, ip: req.ip });
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
    if (ctx.tables.removePlayer(table.id, target)) {
      hub.kick(table.id, target);
      // Convidado sem nenhuma mesa não tem por que continuar com uma sessão aberta
      if (ctx.users.findById(target)?.kind === 'guest' && !ctx.tables.listForUser(target).length) {
        ctx.auth.logoutAll(target);
        hub.userSessionsEnded(target);
      }
    }
    return reply.code(204).send();
  });

  // --- Convites --------------------------------------------------------------

  /**
   * Gera um convite: 192 bits aleatórios, de **uso único**, válido por 7 dias. É mostrado UMA vez,
   * e o banco guarda só o hash. O código vai no fragmento do link (depois do #), que não chega ao
   * servidor nem aos logs. `targetUserId`: link de retorno para uma conta que já existe.
   */
  const newInvite = (tableId: string, userId: string, targetUserId: string | null) => {
    const code = ctx.tokens.generate(24);
    const now = Date.now();
    const expiresAt = now + INVITE_TTL_MS;
    if (!ctx.tables.createInvite(ctx.tokens.hash(code, 'invite'), tableId, userId, now, expiresAt, 1, targetUserId)) {
      throw forbidden('Só o mestre pode fazer isso.');
    }
    return { code, expiresAt, link: `${ctx.config.publicUrl}/convite#codigo=${code}` };
  };

  app.post('/tables/:id/invites', async (req, reply) => {
    const { table, userId } = gmAccess(req);
    return reply.code(201).send(newInvite(table.id, userId, null));
  });

  /** Link de retorno: o convidado trocou de aparelho ou limpou o navegador, e volta à mesma conta. */
  app.post('/tables/:id/members/:userId/access-link', async (req, reply) => {
    const { table, userId } = gmAccess(req);
    const target = parse(memberParams, req.params).userId;
    if (ctx.users.findById(target)?.kind !== 'guest' || !ctx.tables.roleOf(table.id, target)) throw notFound('Jogador não encontrado.');
    return reply.code(201).send(newInvite(table.id, userId, target));
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
      // Link de retorno é da conta dele: outra conta logada não pode usá-lo
      if (!invite || invite.expiresAt <= Date.now() || invite.uses >= invite.maxUses || invite.targetUserId) throw new HttpError(404, INVITE_INVALID);
      const table = ctx.tables.find(invite.tableId);
      if (!table) throw new HttpError(404, INVITE_INVALID);
      if (ctx.tables.roleOf(table.id, user.id)) return table.id;
      if (ctx.tables.playerCount(table.id) >= table.maxPlayers) throw conflict('A mesa está cheia.');
      ctx.tables.addMember(table.id, user.id, 'player', Date.now());
      ctx.tables.useInvite(codeHash);
      return table.id;
    });
    return { table: ctx.tables.findForMember(tableId, user.id) };
  });

  /**
   * Entra no app por um convite, sem conta: só com o nome (ou com a conta do link de retorno).
   * Pública, mas só faz algo com um código válido; tudo acontece numa transação, então dois usos
   * do mesmo código ao mesmo tempo não passam juntos.
   */
  app.post('/invites/redeem', { config: { ...AUTH_RATE_LIMIT, ...PUBLIC } }, async (req, reply) => {
    const { code, name, password } = parse(redeemBody, req.body);
    const codeHash = ctx.tokens.hash(code, 'invite');
    // Nome da conta: o informado ou, no link de retorno, o atual. Nome e senha conferidos e hash
    // calculado antes da transação (o hash é lento); o convite é conferido de novo lá dentro
    const peek = ctx.tables.findInvite(codeHash);
    const returning = peek?.targetUserId ? ctx.users.findById(peek.targetUserId) : null;
    const accountName = name ?? returning?.name;
    const credentials = accountName && password ? await ctx.auth.guestCredentials(accountName, password) : null;
    const { tableId, user, token } = transaction(ctx.db, () => {
      const invite = ctx.tables.findInvite(codeHash);
      if (!invite || invite.expiresAt <= Date.now() || invite.uses >= invite.maxUses) throw new HttpError(404, INVITE_INVALID);
      const table = ctx.tables.find(invite.tableId);
      if (!table) throw new HttpError(404, INVITE_INVALID);
      if (invite.targetUserId) {
        // Link de retorno: define uma senha nova (e o nome, se o atual já é de outra conta)
        const target = ctx.users.findById(invite.targetUserId);
        if (!target || !ctx.tables.roleOf(table.id, target.id)) throw new HttpError(404, INVITE_INVALID);
        if (!credentials || target.id !== returning?.id) throw badRequest('Crie uma senha nova.');
        ctx.tables.useInvite(codeHash);
        const newName = name ?? target.name;
        const session = ctx.auth.setGuestPassword(target, newName, credentials);
        return { tableId: table.id, user: { ...target, name: newName, hasPassword: true }, token: session };
      }
      if (!name || !credentials) throw badRequest('Informe o seu nome e crie uma senha.');
      if (ctx.tables.playerCount(table.id) >= table.maxPlayers) throw conflict('A mesa está cheia.');
      const guest = ctx.auth.createGuest(name, credentials);
      ctx.tables.addMember(table.id, guest.id, 'player', Date.now());
      ctx.tables.useInvite(codeHash);
      return { tableId: table.id, user: guest, token: null };
    });
    audit(req.log, 'convite.usado', { userId: user.id, tableId, ip: req.ip });
    if (token) {
      // As outras sessões da conta caíram: as conexões abertas com elas também
      hub.userSessionsEnded(user.id);
      audit(req.log, 'senha.redefinida_por_link', { userId: user.id, tableId, ip: req.ip });
    }
    setSessionCookie(reply, ctx, token ?? ctx.auth.sessionFor(user), user);
    return { user, table: ctx.tables.findForMember(tableId, user.id) };
  });

  /**
   * O que é este código, sem gastá-lo: convite novo, ou link de retorno (com o nome da conta e se ele
   * já é de outra conta). A página do convite mostra o formulário certo a partir disto.
   */
  app.post('/invites/info', { config: { ...AUTH_RATE_LIMIT, ...PUBLIC } }, async (req) => {
    const { code } = parse(acceptBody, req.body);
    const invite = ctx.tables.findInvite(ctx.tokens.hash(code, 'invite'));
    if (!invite || invite.expiresAt <= Date.now() || invite.uses >= invite.maxUses || !ctx.tables.find(invite.tableId)) throw new HttpError(404, INVITE_INVALID);
    if (!invite.targetUserId) return { kind: 'new' };
    const target = ctx.users.findById(invite.targetUserId);
    if (!target || !ctx.tables.roleOf(invite.tableId, target.id)) throw new HttpError(404, INVITE_INVALID);
    // Precisa de um nome novo: o atual já é o login de outra conta, ou tem @ (convidados antigos)
    const nameTaken = !validGuestName(target.name) || ctx.users.loginTaken(loginNameOf(target.name), target.id);
    return { kind: 'return', name: target.name, nameTaken };
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

  /**
   * Jogador que controla um NPC do bestiário grava a ficha base dele (o mundo é do mestre: a rota
   * de itens do mundo só aceita o dono). O item continua no mundo do mestre.
   */
  app.patch('/tables/:id/npcs/:itemId', { bodyLimit: MAX_NPC_BYTES }, async (req) => {
    const { table, role, userId } = access(req);
    const { itemId } = parse(npcParams, req.params);
    const body = parse(npcBody, req.body);
    const npc = ctx.worlds.findItem(table.worldId, itemId) as WorldItem | null;
    if (npc?.type !== 'npc') throw notFound('NPC não encontrado.');
    const rules = hub.ruleContextOf(table.id, table.worldId, { role, userId }, requireAuth(req).user.name);
    const change = controlledNpcChange(rules, npc, body as ControlledNpcPatch);
    if (!change.ok) throw forbidden(change.reason);
    const json = JSON.stringify(change.payload);
    if (json.length > MAX_NPC_BYTES) throw new HttpError(413, 'NPC grande demais.');
    ctx.worlds.upsertItem(table.worldId, table.ownerId, itemId, json, Date.now());
    hub.worldChanged(table.worldId);
    return { item: change.payload };
  });
}
