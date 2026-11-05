import { randomUUID } from 'node:crypto';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { AppContext } from './context';
import { PUBLIC, registerAuth } from './http/plugins/auth';
import { registerSecurity } from './http/plugins/security';
import { authRoutes } from './http/routes/auth';
import { devRoutes } from './http/routes/dev';
import { fileRoutes } from './http/routes/files';
import { frontendRoutes } from './http/routes/frontend';
import { libraryRoutes } from './http/routes/library';
import { tableRoutes } from './http/routes/tables';
import { worldRoutes } from './http/routes/worlds';
import { audit } from './lib/audit';
import { HttpError } from './lib/errors';
import { RealtimeHub } from './realtime/hub';

export interface App {
  http: FastifyInstance;
  hub: RealtimeHub;
}

/** Campos ocultados no log, em qualquer objeto registrado (cabeçalhos, corpos, erros). */
const REDACT = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  '*.cookie',
  '*.password',
  '*.current',
  '*.next',
  '*.token',
  '*.code',
  '*.secret',
  '*.pepper',
  '*.email',
];

export interface BuildOptions {
  /** Destino do log (testes leem os eventos de segurança); padrão: saída do processo. */
  logStream?: NodeJS.WritableStream;
}

/**
 * Monta o servidor (HTTP + WebSocket) sem começar a escutar: `main.ts` chama `listen`, e os
 * testes usam o mesmo app com banco em memória.
 */
export async function buildApp(ctx: AppContext, options: BuildOptions = {}): Promise<App> {
  const { config } = ctx;
  const http = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      // Nada de segredo no log: cookies, senhas, tokens, códigos de convite e e-mails são ocultados
      redact: { paths: REDACT, censor: '[oculto]' },
      ...(options.logStream && { stream: options.logStream }),
    },
    // Id de requisição aleatório (não revela quantas houve) e nunca vindo do cliente
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    // Só os proxies da lista (nenhum = IP da conexão): mesma regra de `lib/client-ip.ts` no WebSocket
    trustProxy: config.trustedProxies.entries.length ? [...config.trustedProxies.entries] : false,
    bodyLimit: 1024 * 1024,
    // Requisição lenta de propósito (slowloris) não segura o servidor; 10 min: envio de arquivos grandes
    requestTimeout: 600_000,
    connectionTimeout: 60_000,
    return503OnClosing: true,
    // Corpos JSON com __proto__/constructor são recusados (não só removidos)
    onProtoPoisoning: 'error',
    onConstructorPoisoning: 'error',
  });

  // --- Erros: mensagem segura para o cliente, detalhe só no log -------------------
  http.setErrorHandler((err: FastifyError | HttpError, req, reply) => {
    if (err instanceof HttpError) {
      if (err.statusCode === 403) audit(req.log, 'permissao.negada', { userId: req.auth?.user.id, method: req.method, url: req.url });
      return reply.code(err.statusCode).send({ error: err.message, ...(err.details && { details: err.details }) });
    }
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      // Detalhe e pilha só no log; o cliente recebe o id da requisição para o suporte achar o registro
      req.log.error({ err }, 'erro interno');
      return reply.code(500).send({ error: 'Erro interno.', requestId: req.id });
    }
    // Erros do próprio Fastify/plugins (corpo grande, JSON inválido, tipo não aceito…)
    return reply.code(status).send({ error: clientMessage(status) });
  });
  http.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'Não encontrado.' }));

  await registerSecurity(http, config);
  await registerAuth(http, ctx);
  await http.register(multipart, {
    limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 0, parts: 1, headerPairs: 50 },
  });

  const hub = new RealtimeHub(ctx, http.log);

  http.get('/api/health', { config: PUBLIC }, async () => ({ status: 'ok' }));
  await http.register(async (api) => authRoutes(api, ctx, hub), { prefix: '/api/auth' });
  await http.register(async (api) => tableRoutes(api, ctx, hub), { prefix: '/api' });
  await http.register(async (api) => worldRoutes(api, ctx, hub), { prefix: '/api' });
  await http.register(async (api) => fileRoutes(api, ctx), { prefix: '/api' });
  await http.register(async (api) => libraryRoutes(api, ctx), { prefix: '/api' });
  if (config.DEV_TOOLS) await http.register(async (dev) => devRoutes(dev, config));
  // App Angular compilado (FRONTEND_DIR): o que não é da API cai no index.html (rotas do app)
  await http.register(async (front) => frontendRoutes(front, config));

  hub.attach(http.server);
  // preClose: antes de o HTTP parar, senão o fechamento esperaria os sockets abertos
  http.addHook('preClose', async () => hub.shutdown());
  return { http, hub };
}

/** Mensagem genérica por status (não repassa o texto interno do erro). */
function clientMessage(status: number): string {
  switch (status) {
    case 400:
      return 'Requisição inválida.';
    case 401:
      return 'Faça login para continuar.';
    case 403:
      return 'Você não tem permissão para isso.';
    case 404:
      return 'Não encontrado.';
    case 406:
    case 415:
      return 'Tipo de conteúdo não aceito.';
    case 413:
      return 'Conteúdo grande demais.';
    case 429:
      return 'Muitas requisições. Tente de novo em instantes.';
    default:
      return 'Requisição inválida.';
  }
}
