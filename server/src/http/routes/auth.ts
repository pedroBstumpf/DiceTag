import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { audit } from '../../lib/audit';
import { HttpError, parse } from '../../lib/errors';
import { email, newPassword, passwordInput, text, withPasswordPolicy } from '../../lib/schemas';
import { PUBLIC, clearSessionCookie, requireAuth, sessionCookieName, setSessionCookie } from '../plugins/auth';
import { AUTH_RATE_LIMIT } from '../plugins/security';

const registerBody = withPasswordPolicy(z.strictObject({ name: text(1, 60), email, password: newPassword }));
const loginBody = z.strictObject({ email, password: passwordInput });
const passwordBody = z.strictObject({ current: passwordInput, next: newPassword });
const profileBody = z.strictObject({ name: text(1, 60) });

/**
 * /api/auth — cadastro, login, logout, conta atual, perfil e troca de senha.
 * O token de sessão só existe no cookie HttpOnly: nunca aparece no corpo das respostas.
 * Públicas (sem sessão): cadastro, login e logout; as demais exigem login (hook de `plugins/auth.ts`).
 */
export async function authRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
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
    const result = await ctx.auth.login(body.email, body.password).catch((err: unknown) => {
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
    if (req.auth) audit(req.log, 'sessao.encerrada', { userId: req.auth.user.id });
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

  app.post('/password', { config: AUTH_RATE_LIMIT }, async (req, reply) => {
    const session = requireAuth(req);
    const body = parse(passwordBody, req.body);
    await ctx.auth.changePassword(session, body.current, body.next);
    audit(req.log, 'senha.trocada', { userId: session.user.id, ip: req.ip });
    return reply.code(204).send();
  });
}
