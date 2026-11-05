import type { FastifyInstance, FastifyRequest } from 'fastify';
import { allowPublicOrigin } from '../../config/env';
import type { AppContext } from '../../context';
import { forbidden } from '../../lib/errors';
import type { HostStatus } from '../../ops/tailscale';
import { requireOwner } from '../plugins/auth';

/** Cabeçalhos que só aparecem em quem chegou por um proxy, como o túnel do Tailscale. */
const PROXY_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded', 'tailscale-funnel-request'];
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * A requisição veio do próprio computador, sem passar pelo túnel? A conexão do túnel também chega
 * de 127.0.0.1, mas com os cabeçalhos do proxy, que quem está fora não consegue tirar, e o endereço
 * público no Host.
 */
export function isDirectLocal(req: FastifyRequest): boolean {
  if (!LOOPBACK.has(req.raw.socket.remoteAddress ?? '')) return false;
  if (PROXY_HEADERS.some((name) => req.headers[name] !== undefined)) return false;
  const host = (req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1';
}

/**
 * /api/host — abrir e fechar a mesa aos jogadores, pelo app. Só o dono vê a situação; abrir, fechar
 * e abrir a pasta ainda exigem que o pedido venha deste computador. Mesmo com a senha do dono,
 * ninguém liga, desliga ou mexe nisso pela internet.
 */
export async function hostRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const local = (req: FastifyRequest) => {
    requireOwner(req);
    if (!isDirectLocal(req)) throw forbidden('Isso só pode ser feito no computador onde o app está rodando.');
  };
  /** O endereço público, assim que conhecido, passa a ser aceito como origem do app. */
  const known = (status: HostStatus) => {
    if (status.url) allowPublicOrigin(ctx.config, status.url);
    return { ...status, local: true };
  };

  app.get('/host', async (req) => {
    requireOwner(req);
    const status = await ctx.host.status();
    if (status.url) allowPublicOrigin(ctx.config, status.url);
    return { ...status, local: isDirectLocal(req) };
  });

  app.post('/host/open', async (req) => {
    local(req);
    return known(await ctx.host.open());
  });

  app.post('/host/close', async (req) => {
    local(req);
    return known(await ctx.host.close());
  });

  app.post('/host/open-folder', async (req, reply) => {
    local(req);
    await ctx.host.openFolder();
    return reply.code(204).send();
  });
}
