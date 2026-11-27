import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context';
import type { RealtimeHub } from '../../realtime/hub';
import { requireOwner } from '../plugins/auth';

/**
 * /api/gm — Painel do Mestre (ADR-0007).
 *
 * Só o dono do app (que é o mestre das mesas que cria) e só leitura: o painel age pelas rotas que já
 * existem em /api/tables, cada uma com a própria conferência de papel. Aqui só há contagens e datas,
 * nunca o conteúdo da partida (fichas, chat, mapa).
 */
export async function gmRoutes(app: FastifyInstance, ctx: AppContext, hub: RealtimeHub): Promise<void> {
  app.get('/gm/overview', async (req, reply) => {
    const { user } = requireOwner(req);
    const tables = ctx.tables.gmOverview(user.id, Date.now()).map((t) => ({ ...t, online: hub.presence(t.id) }));
    // Resposta autenticada: não guardar em cache (doc 04 §3)
    reply.header('Cache-Control', 'no-store');
    return {
      tables,
      totals: {
        tables: tables.length,
        players: tables.reduce((n, t) => n + t.players, 0),
        pendingInvites: tables.reduce((n, t) => n + t.pendingInvites, 0),
        online: tables.reduce((n, t) => n + t.online, 0),
      },
    };
  });
}
