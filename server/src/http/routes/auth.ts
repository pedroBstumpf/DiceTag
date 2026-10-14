import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { parse } from '../../lib/errors';
import { email, passwordInput, text } from '../../lib/schemas';
import { clearSessionCookie, requireAuth, sessionCookieName, setSessionCookie } from '../plugins/auth';
import { AUTH_RATE_LIMIT } from '../plugins/security';

const registerBody = z.strictObject({ name: text(1, 60), email, password: passwordInput });
const loginBody = z.strictObject({ email, password: passwordInput });
const passwordBody = z.strictObject({ current: passwordInput, next: passwordInput });
const profileBody = z.strictObject({ name: text(1, 60) });

/**
 * /api/auth — cadastro, login, logout, conta atual, perfil e troca de senha.
 * O token de sessão só existe no cookie HttpOnly: nunca aparece no corpo das respostas.
 */
export async function authRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.post('/register', { config: AUTH_RATE_LIMIT }, async (req, reply) => {
    const body = parse(registerBody, req.body);
    const { user, token } = await ctx.auth.register(body);
    setSessionCookie(reply, ctx, token);
    return reply.code(201).send({ user });
  });

  app.post('/login', { config: AUTH_RATE_LIMIT }, async (req, reply) => {
    const body = parse(loginBody, req.body);
    const { user, token } = await ctx.auth.login(body.email, body.password);
    setSessionCookie(reply, ctx, token);
    return { user };
  });

  app.post('/logout', async (req, reply) => {
    const token = req.cookies[sessionCookieName(ctx.config)];
    if (token) ctx.auth.logout(token);
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
    return reply.code(204).send();
  });
}
