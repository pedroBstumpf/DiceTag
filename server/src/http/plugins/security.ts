import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../../config/env';
import { forbidden, HttpError } from '../../lib/errors';
import { SAFE_METHODS, isAllowedOrigin } from '../../security/origin';

/**
 * Camada de segurança HTTP aplicada a todas as rotas:
 *
 * 1. Cabeçalhos (helmet): CSP que não permite nada (a API só devolve JSON e arquivos), proíbe
 *    abrir em iframe (clickjacking), `nosniff`, sem Referer, HSTS em produção.
 * 2. CORS: só as origens de ALLOWED_ORIGINS, com cookie.
 * 3. Limite de requisições por IP (rotas sensíveis têm limites próprios, mais baixos).
 * 4. Conferência de origem nas requisições que alteram dados (CSRF), além do SameSite=Strict
 *    do cookie: duas defesas independentes.
 * 5. Só JSON é aceito no corpo (o Fastify também aceitaria text/plain, que um formulário de
 *    outro site consegue enviar sem CORS: o parser é removido).
 */
export async function registerSecurity(app: FastifyInstance, config: Config): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    // Imagens servidas pela API são usadas pelo front-end em outra porta do mesmo site (localhost)
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
    frameguard: { action: 'deny' },
    hsts: config.isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });

  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || config.allowedOrigins.has(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type'],
    maxAge: 600,
  });

  if (config.RATE_LIMIT) {
    await app.register(rateLimit, {
      global: true,
      max: 300,
      timeWindow: '1 minute',
      errorResponseBuilder: (_req, ctx) => new HttpError(429, `Muitas requisições. Tente de novo em ${Math.ceil(ctx.ttl / 1000)}s.`),
    });
  }

  app.removeContentTypeParser('text/plain');

  // CSRF: requisições que alteram dados precisam vir de uma origem autorizada
  app.addHook('onRequest', async (req) => {
    if (SAFE_METHODS.has(req.method)) return;
    if (!isAllowedOrigin(req.headers, config.allowedOrigins)) throw forbidden('Origem não autorizada.');
  });
}

/** Limite das rotas de autenticação (por IP): 10 por minuto. */
export const AUTH_RATE_LIMIT = { rateLimit: { max: 10, timeWindow: '1 minute' } };
/** Limite de envio de arquivos (por IP): 30 por minuto. */
export const UPLOAD_RATE_LIMIT = { rateLimit: { max: 30, timeWindow: '1 minute' } };
