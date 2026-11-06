import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import type { RealtimeHub } from '../../realtime/hub';
import { AccountService } from '../../services/account.service';
import { PASSWORD_RESET_MINUTES } from '../../services/auth.service';
import { passwordResetMail } from '../../services/mailer';
import { audit } from '../../lib/audit';
import { transaction } from '../../db/database';
import { HttpError, badRequest, conflict, parse } from '../../lib/errors';
import { validGuestName } from '../../lib/login-name';
import { email, newPassword, passwordInput, text } from '../../lib/schemas';
import { PUBLIC, clearSessionCookie, requireAuth, sessionCookieName, setSessionCookie } from '../plugins/auth';
import { AUTH_RATE_LIMIT } from '../plugins/security';

/** `login`: e-mail (dono) ou o nome da mesa (convidado com senha). */
const loginBody = z.strictObject({ login: z.string().trim().min(1).max(254), password: passwordInput });
const passwordBody = z.strictObject({ current: passwordInput, next: newPassword });
/** `name`: só quando o nome atual não serve para entrar (já é o login de outra conta ou tem @). */
const createPasswordBody = z.strictObject({ password: newPassword, name: text(1, 40).optional() });
const profileBody = z.strictObject({ name: text(1, 60) });
/** Convidado antigo, sem senha: a sessão é a única credencial dele. */
const deleteBody = z.strictObject({ password: passwordInput.optional() });
const forgotBody = z.strictObject({ email });
const ALREADY_HAS_PASSWORD = 'Esta conta já tem senha.';
const resetBody = z.strictObject({ token: z.string().min(20).max(100).regex(/^[A-Za-z0-9_-]+$/), password: newPassword });

/**
 * /api/auth — login (dono pelo e-mail, convidado pelo nome da mesa), logout (desta sessão ou de todas), conta atual, perfil, troca de senha,
 * exportação dos dados e exclusão da conta (LGPD).
 * O token de sessão só existe no cookie HttpOnly: nunca aparece no corpo das respostas.
 * Não há cadastro: o dono é criado no terminal e os demais entram por convite (`routes/tables.ts`).
 * Públicas (sem sessão): login, logout e recuperação de senha; as demais exigem login (hook de `plugins/auth.ts`).
 */
export async function authRoutes(app: FastifyInstance, ctx: AppContext, hub: RealtimeHub): Promise<void> {
  const account = new AccountService(ctx, hub);

  app.post('/login', { config: { ...AUTH_RATE_LIMIT, ...PUBLIC } }, async (req, reply) => {
    const body = parse(loginBody, req.body);
    const attempt = { loginRef: ctx.tokens.ref(body.login.toLowerCase()), ip: req.ip };
    const result = await ctx.auth.login(body.login, body.password, req.ip).catch((err: unknown) => {
      if (err instanceof HttpError && (err.statusCode === 401 || err.statusCode === 429)) {
        audit(req.log, err.statusCode === 429 ? 'login.bloqueado' : 'login.falha', attempt);
      }
      throw err;
    });
    audit(req.log, 'login.ok', { userId: result.user.id, ip: req.ip });
    setSessionCookie(reply, ctx, result.token, result.user);
    return { user: result.user };
  });

  app.post('/logout', { config: PUBLIC }, async (req, reply) => {
    const token = req.cookies[sessionCookieName(ctx.config)];
    if (token) ctx.auth.logout(token);
    if (req.auth) {
      hub.sessionEnded(req.auth.tokenHash);
      audit(req.log, 'sessao.encerrada', { userId: req.auth.user.id });
    }
    clearSessionCookie(reply, ctx);
    return reply.code(204).send();
  });

  // --- Recuperação de senha ------------------------------------------------------

  /**
   * Pede o link por e-mail. A resposta é sempre a mesma, exista ou não a conta, e sai antes do envio
   * (o tempo de resposta também não entrega se o e-mail tem conta).
   */
  app.post('/password/forgot', { config: { ...AUTH_RATE_LIMIT, ...PUBLIC } }, async (req, reply) => {
    const body = parse(forgotBody, req.body);
    const attempt = { emailRef: ctx.tokens.ref(body.email), ip: req.ip };
    if (!ctx.mailer.enabled) {
      audit(req.log, 'senha.recuperacao_sem_email', attempt);
      return reply.code(202).send({ ok: true });
    }
    audit(req.log, 'senha.recuperacao_pedida', attempt);
    const request = ctx.auth.createPasswordReset(body.email);
    if (request) {
      const mail = passwordResetMail(request.user.email, request.user.name, request.link, PASSWORD_RESET_MINUTES);
      void ctx.mailer.send(mail).catch((err: unknown) => req.log.error({ motivo: err instanceof Error ? err.message : 'desconhecido', userId: request.user.id }, 'e-mail de recuperação não enviado'));
    }
    return reply.code(202).send({ ok: true });
  });

  /** Redefine a senha com o token do link. Não abre sessão: a pessoa entra de novo com a senha nova. */
  app.post('/password/reset', { config: { ...AUTH_RATE_LIMIT, ...PUBLIC } }, async (req, reply) => {
    const body = parse(resetBody, req.body);
    const userId = await ctx.auth.resetPassword(body.token, body.password, req.ip);
    hub.userSessionsEnded(userId);
    audit(req.log, 'senha.redefinida', { userId, ip: req.ip });
    return reply.code(204).send();
  });

  /** Sair de todos os dispositivos: encerra todas as sessões da conta, inclusive esta. */
  app.post('/logout-all', async (req, reply) => {
    const { user } = requireAuth(req);
    ctx.auth.logoutAll(user.id);
    hub.userSessionsEnded(user.id);
    audit(req.log, 'sessoes.encerradas', { userId: user.id, ip: req.ip });
    clearSessionCookie(reply, ctx);
    return reply.code(204).send();
  });

  app.get('/me', async (req) => ({ user: requireAuth(req).user }));

  app.patch('/me', async (req) => {
    const session = requireAuth(req);
    const { name } = parse(profileBody, req.body);
    // Convidado com senha entra pelo nome: o nome de entrada muda junto, sem repetir o de outra conta
    if (session.user.kind === 'guest' && session.user.hasPassword) transaction(ctx.db, () => ctx.auth.renameGuest(session.user, name));
    else if (session.user.kind === 'guest' && !validGuestName(name)) throw badRequest('Escolha um nome sem @.');
    else ctx.users.rename(session.user.id, name);
    return { user: { ...session.user, name } };
  });

  /** Convidado antigo, sem senha, cria a dele: passa a entrar pelo nome de qualquer aparelho. */
  app.post('/password/create', { config: AUTH_RATE_LIMIT }, async (req, reply) => {
    const session = requireAuth(req);
    const { password, name } = parse(createPasswordBody, req.body);
    if (session.user.kind !== 'guest' || session.user.hasPassword) throw conflict(ALREADY_HAS_PASSWORD);
    const newName = name ?? session.user.name;
    const credentials = await ctx.auth.guestCredentials(newName, password);
    const token = transaction(ctx.db, () => {
      // Conferido de novo aqui: o hash leva tempo, e outro pedido pode ter criado a senha nesse meio-tempo
      if (ctx.users.findById(session.user.id)?.hasPassword) throw conflict(ALREADY_HAS_PASSWORD);
      return ctx.auth.setGuestPassword(session.user, newName, credentials);
    });
    hub.userSessionsEnded(session.user.id);
    audit(req.log, 'senha.criada', { userId: session.user.id, ip: req.ip });
    setSessionCookie(reply, ctx, token, { ...session.user, name: newName, hasPassword: true });
    return reply.code(204).send();
  });

  // --- LGPD: acesso aos dados e exclusão da conta ----------------------------------

  /** Todos os dados da conta num arquivo JSON (o conteúdo dos arquivos sai por /api/files/:id). */
  app.get('/me/export', async (req, reply) => {
    const { user } = requireAuth(req);
    return reply
      .header('Content-Disposition', 'attachment; filename="zehenia-meus-dados.json"')
      .header('Cache-Control', 'no-store')
      .send(account.export(user));
  });

  /** Exclui a conta e tudo o que é dela. Pede a senha de novo (o cookie sozinho não basta). */
  app.delete('/me', { config: AUTH_RATE_LIMIT }, async (req, reply) => {
    const session = requireAuth(req);
    const { password } = parse(deleteBody, req.body);
    // Quem tem senha (o dono e os convidados com senha) confirma com ela
    if (session.user.hasPassword && !(await ctx.auth.verifyPassword(session.user.id, password ?? ''))) throw new HttpError(401, 'Senha incorreta.');
    await account.delete(session.user.id);
    audit(req.log, 'conta.excluida', { userId: session.user.id });
    clearSessionCookie(reply, ctx);
    return reply.code(204).send();
  });

  app.post('/password', { config: AUTH_RATE_LIMIT }, async (req, reply) => {
    const session = requireAuth(req);
    const body = parse(passwordBody, req.body);
    // Todas as sessões caem (inclusive as conexões abertas); quem trocou segue com uma sessão nova
    const token = await ctx.auth.changePassword(session, body.current, body.next);
    hub.userSessionsEnded(session.user.id);
    audit(req.log, 'senha.trocada', { userId: session.user.id, ip: req.ip });
    setSessionCookie(reply, ctx, token, session.user);
    return reply.code(204).send();
  });
}
