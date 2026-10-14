import cookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../../context';
import { unauthorized } from '../../lib/errors';
import { sessionCookieName } from '../../security/cookie';
import type { AuthSession } from '../../services/auth.service';

declare module 'fastify' {
  interface FastifyRequest {
    /** Sessão de quem fez a requisição (null = não logado). */
    auth: AuthSession | null;
  }
}

export { sessionCookieName };

/**
 * Sessão por cookie: lê o cookie em toda requisição e preenche `req.auth`.
 * Cookie `HttpOnly` (o JavaScript da página não lê: um XSS não rouba a sessão),
 * `SameSite=Strict` (não vai em requisições vindas de outros sites) e `Secure`.
 */
export async function registerAuth(app: FastifyInstance, ctx: AppContext): Promise<void> {
  await app.register(cookie);
  const name = sessionCookieName(ctx.config);
  app.decorateRequest('auth', null);
  app.addHook('onRequest', async (req) => {
    req.auth = ctx.auth.resolve(req.cookies[name]);
  });
}

/** Sessão obrigatória: sem login = 401. */
export function requireAuth(req: FastifyRequest): AuthSession {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

export function setSessionCookie(reply: FastifyReply, ctx: AppContext, token: string): void {
  reply.setCookie(sessionCookieName(ctx.config), token, {
    httpOnly: true,
    secure: ctx.config.COOKIE_SECURE,
    sameSite: 'strict',
    path: '/',
    maxAge: ctx.auth.sessionMaxAgeSeconds,
  });
}

export function clearSessionCookie(reply: FastifyReply, ctx: AppContext): void {
  reply.clearCookie(sessionCookieName(ctx.config), { httpOnly: true, secure: ctx.config.COOKIE_SECURE, sameSite: 'strict', path: '/' });
}
