import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import type { RealtimeHub } from '../../realtime/hub';
import { AccountService } from '../../services/account.service';
import { audit } from '../../lib/audit';
import { HttpError, parse } from '../../lib/errors';
import { email, newPassword, passwordInput, text, withPasswordPolicy } from '../../lib/schemas';
import { PUBLIC, clearSessionCookie, requireAuth, sessionCookieName, setSessionCookie } from '../plugins/auth';
import { AUTH_RATE_LIMIT } from '../plugins/security';

const registerBody = withPasswordPolicy(z.strictObject({ name: text(1, 60), email, password: newPassword }));
const loginBody = z.strictObject({ email, password: passwordInput });
const passwordBody = z.strictObject({ current: passwordInput, next: newPassword });
const profileBody = z.strictObject({ name: text(1, 60) });
const deleteBody = z.strictObject({ password: passwordInput });

/**
 * /api/auth — cadastro, login, logout (desta sessão ou de todas), conta atual, perfil, troca de senha,
 * exportação dos dados e exclusão da conta (LGPD).
 * O token de sessão só existe no cookie HttpOnly: nunca aparece no corpo das respostas.
 * Públicas (sem sessão): cadastro, login e logout; as demais exigem login (hook de `plugins/auth.ts`).
 */
export async function authRoutes(app: FastifyInstance, ctx: AppContext, hub: RealtimeHub): Promise<void> {
  const account = new AccountService(ctx, hub);

  app.post('/register', { config: { ...AUTH_RATE_LIMIT, ...PUBLIC } }, async (req, reply) => {
    const body = parse(registerBody, req.body);
    const { user, token } = await ctx.auth.register(body);
    audit(req.log, 'conta.criada', { userId: user.id, ip: req.ip });
    setSessionCookie(reply, ctx, token);
    return reply.code(201).send({ user });
  });

  app.post('/login', { config: { ...AUTH_RATE_LIMIT, ...PUBLIC } }, async (req, reply) => {
    const body = parse(loginBody, req.body);
    const attempt = { emailRef: ctx.tokens.ref(body.email), ip: req.ip };
    const result = await ctx.auth.login(body.email, body.password, req.ip).catch((err: unknown) => {
      if (err instanceof HttpError && (err.statusCode === 401 || err.statusCode === 429)) {
        audit(req.log, err.statusCode === 429 ? 'login.bloqueado' : 'login.falha', attempt);
      }
      throw err;
    });
    audit(req.log, 'login.ok', { userId: result.user.id, ip: req.ip });
    setSessionCookie(reply, ctx, result.token);
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
    ctx.users.rename(session.user.id, name);
    return { user: { ...session.user, name } };
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
    if (!(await ctx.auth.verifyPassword(session.user.id, password))) throw new HttpError(401, 'Senha incorreta.');
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
    setSessionCookie(reply, ctx, token);
    return reply.code(204).send();
  });
}
