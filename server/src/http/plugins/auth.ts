import cookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../../context';
import { unauthorized } from '../../lib/errors';
import { sessionCookieName } from '../../security/cookie';
import type { AuthSession } from '../../services/auth.service';

declare module 'fastify' {
  interface FastifyRequest {
    /** Sessão de quem fez a requisição (null = não logado: só chega a rotas públicas). */
    auth: AuthSession | null;
  }
  interface FastifyContextConfig {
    /** Rota pública: atende sem sessão. Toda rota sem esta marca exige login (negar por padrão). */
    public?: boolean;
  }
}

export { sessionCookieName };

/** Configuração de rota pública (lista explícita: cadastro, login, logout, saúde e página de testes). */
export const PUBLIC = { public: true } as const;

/**
 * Sessão por cookie, com **negar por padrão** (BACKEND_SECURITY.md §0 e §3): o hook global lê o
 * cookie em toda requisição, preenche `req.auth` e responde 401 em qualquer rota que não esteja
 * marcada como pública (`config: { public: true }`). Uma rota nova esquecida nasce protegida.
 *
 * Cookie `HttpOnly` (o JavaScript da página não lê: um XSS não rouba a sessão),
 * `SameSite=Strict` (não vai em requisições vindas de outros sites) e `Secure`.
 */
export async function registerAuth(app: FastifyInstance, ctx: AppContext): Promise<void> {
  await app.register(cookie);
  const name = sessionCookieName(ctx.config);
  app.decorateRequest('auth', null);
  app.addHook('onRequest', async (req) => {
    req.auth = ctx.auth.resolve(req.cookies[name]);
    // Rota inexistente segue para o 404; as demais, sem sessão, só se forem públicas
    if (!req.auth && !req.is404 && !req.routeOptions.config.public) throw unauthorized();
  });
}

/** Sessão da requisição (o hook já barrou quem não tem; aqui só dá o tipo certo às rotas). */
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
