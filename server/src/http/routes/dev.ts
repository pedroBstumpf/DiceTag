import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../../config/env';

/** Arquivos da página de testes (fixos: nada da URL vira caminho de arquivo). */
const PAGES = {
  '/dev/': { file: 'ws-test.html', type: 'text/html; charset=utf-8' },
  '/dev/ws-test.js': { file: 'ws-test.js', type: 'text/javascript; charset=utf-8' },
  '/dev/ws-test.css': { file: 'ws-test.css', type: 'text/css; charset=utf-8' },
} as const;

/**
 * Página de testes local (/dev/): login, mesas, convites e um console do WebSocket.
 * Registrada SÓ com DEV_TOOLS=true (o servidor recusa isso em produção — `config/env.ts`).
 * CSP própria: só scripts e estilos deste servidor, conexão só com ele mesmo.
 */
export async function devRoutes(app: FastifyInstance, config: Config): Promise<void> {
  const host = `${config.HOST === '0.0.0.0' ? 'localhost' : config.HOST}:${config.PORT}`;
  const csp = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    `connect-src 'self' ws://${host} ws://localhost:${config.PORT}`,
    "img-src 'self' blob:",
    "media-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');

  for (const [path, page] of Object.entries(PAGES)) {
    const url = new URL(`../../../dev/${page.file}`, import.meta.url);
    app.get(path, async (_req, reply) =>
      reply.header('Content-Type', page.type).header('Content-Security-Policy', csp).header('Cache-Control', 'no-store').send(await readFile(fileURLToPath(url))),
    );
  }
  app.get('/dev', async (_req, reply) => reply.redirect('/dev/'));
}
