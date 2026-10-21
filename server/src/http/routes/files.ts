import { createReadStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { HttpError, badRequest, forbidden, notFound, parse } from '../../lib/errors';
import { idSchema, newId } from '../../lib/ids';
import { receiveUpload } from '../../lib/upload';
import { declaredTypeMatches } from '../../security/file-type';
import { requireAuth } from '../plugins/auth';
import { UPLOAD_RATE_LIMIT } from '../plugins/security';

const uploadQuery = z.strictObject({ tableId: idSchema.optional(), worldId: idSchema.optional() });
const fileParams = z.object({ id: idSchema });
const MB = 1024 * 1024;
const QUOTA_FULL = 'Espaço de arquivos esgotado (da conta ou da mesa).';

/**
 * /api/files — envio, download e exclusão de arquivos (mapas, imagens de token, áudios).
 *
 * Envio:
 * - um arquivo por requisição, até MAX_UPLOAD_MB, recebido em streaming direto para o disco;
 * - cotas por conta (USER_QUOTA_MB) e por mesa (TABLE_QUOTA_MB), conferidas de novo, junto com o
 *   registro, numa instrução só (dois envios simultâneos não passam juntos da cota);
 * - tipo conferido pelos bytes, pela extensão e pelo tipo declarado (`security/file-type.ts`):
 *   só imagens raster e áudio; SVG/HTML recusados;
 * - nome escolhido pelo servidor (UUID); o nome original é descartado;
 * - escopo: `tableId` (membro da mesa) ou `worldId` (dono do mundo) define quem pode baixar.
 *
 * Download: só quem enviou, membros da mesa do arquivo ou de mesas do mundo do arquivo; com
 * `nosniff`, CSP `sandbox` e o tipo detectado (o navegador nunca executa o conteúdo).
 */
export async function fileRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const maxBytes = ctx.config.MAX_UPLOAD_MB * MB;

  app.post('/files', { config: UPLOAD_RATE_LIMIT }, async (req, reply) => {
    const { user } = requireAuth(req);
    const scope = parse(uploadQuery, req.query);
    if (!!scope.tableId === !!scope.worldId) throw badRequest('Informe tableId ou worldId.');
    if (scope.tableId && !ctx.tables.roleOf(scope.tableId, user.id)) throw notFound('Mesa não encontrada.');
    if (scope.worldId && !ctx.worlds.findOwned(scope.worldId, user.id)) throw notFound('Mundo não encontrado.');

    const part = await req.file({ limits: { fileSize: maxBytes, files: 1, fields: 0, parts: 1 } });
    if (!part) throw badRequest('Nenhum arquivo enviado.');

    // O que sobra nas cotas limita o envio já no streaming (a conferência final é no registro)
    const quota = { user: ctx.config.USER_QUOTA_MB * MB, table: ctx.config.TABLE_QUOTA_MB * MB };
    const free = Math.min(quota.user - ctx.files.usedBytes(user.id), scope.tableId ? quota.table - ctx.files.tableBytes(scope.tableId) : Infinity);
    if (free <= 0) throw new HttpError(413, QUOTA_FULL);
    const id = newId();
    const temp = ctx.files.tempPathOf(id);
    try {
      const tooBig = maxBytes <= free ? `Arquivo maior que ${ctx.config.MAX_UPLOAD_MB} MB.` : QUOTA_FULL;
      const received = await receiveUpload(part.file, temp, Math.min(maxBytes, free), tooBig);
      if (part.file.truncated) throw new HttpError(413, `Arquivo maior que ${ctx.config.MAX_UPLOAD_MB} MB.`);
      if (!declaredTypeMatches(part.filename, part.mimetype, received.mime)) {
        throw new HttpError(415, 'O nome ou o tipo do arquivo não corresponde ao conteúdo.');
      }
      const record = { id, ownerId: user.id, tableId: scope.tableId ?? null, worldId: scope.worldId ?? null, ...received, createdAt: Date.now() };
      if (!(await ctx.files.commit(record, temp, quota))) throw new HttpError(413, QUOTA_FULL);
      return reply.code(201).send({ file: { id, mime: received.mime, size: received.size } });
    } finally {
      // Recusado no meio do caminho: o temporário some (depois do registro, ele já foi movido)
      await rm(temp, { force: true });
    }
  });

  app.get('/files/:id', async (req, reply) => {
    const { user } = requireAuth(req);
    const { id } = parse(fileParams, req.params);
    // Sem permissão = 404 (não revela que o arquivo existe)
    const file = ctx.files.findAccessible(id, user.id);
    if (!file) throw notFound('Arquivo não encontrado.');
    return reply
      .header('Content-Type', file.mime)
      .header('Content-Length', file.size)
      .header('Content-Disposition', 'inline; filename="arquivo"')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('X-Content-Type-Options', 'nosniff')
      // O conteúdo de um id nunca muda: o navegador pode guardar (só para esta conta)
      .header('Cache-Control', 'private, max-age=86400, immutable')
      .send(createReadStream(ctx.files.pathOf(file.id)));
  });

  /** Excluir: quem enviou, ou o mestre da mesa do arquivo. */
  app.delete('/files/:id', async (req, reply) => {
    const { user } = requireAuth(req);
    const { id } = parse(fileParams, req.params);
    if (!(await ctx.files.deleteIfAllowed(id, user.id))) {
      // Membro que pode ver mas não excluir recebe 403; os demais, 404
      throw ctx.files.findAccessible(id, user.id) ? forbidden() : notFound('Arquivo não encontrado.');
    }
    return reply.code(204).send();
  });
}
