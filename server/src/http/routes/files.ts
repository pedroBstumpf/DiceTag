import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { HttpError, badRequest, forbidden, notFound, parse } from '../../lib/errors';
import { idSchema, newId } from '../../lib/ids';
import type { FileRecord } from '../../repositories/files';
import { detectFileType } from '../../security/file-type';
import { requireAuth } from '../plugins/auth';
import { UPLOAD_RATE_LIMIT } from '../plugins/security';

const uploadQuery = z.strictObject({ tableId: idSchema.optional(), worldId: idSchema.optional() });
const fileParams = z.object({ id: idSchema });

/**
 * /api/files — envio, download e exclusão de arquivos (mapas, imagens de token, áudios).
 *
 * Envio:
 * - um arquivo por requisição, até MAX_UPLOAD_MB; cota total por conta (USER_QUOTA_MB);
 * - tipo conferido pelos bytes (`detectFileType`): só imagens raster e áudio; SVG/HTML recusados;
 * - nome escolhido pelo servidor (UUID); o nome original é descartado;
 * - escopo: `tableId` (membro da mesa) ou `worldId` (dono do mundo) define quem pode baixar.
 *
 * Download: só quem enviou, membros da mesa do arquivo ou de mesas do mundo do arquivo; com
 * `nosniff`, CSP `sandbox` e o tipo detectado (o navegador nunca executa o conteúdo).
 */
export async function fileRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const maxBytes = ctx.config.MAX_UPLOAD_MB * 1024 * 1024;

  app.post('/files', { config: UPLOAD_RATE_LIMIT }, async (req, reply) => {
    const { user } = requireAuth(req);
    const scope = parse(uploadQuery, req.query);
    if (!!scope.tableId === !!scope.worldId) throw badRequest('Informe tableId ou worldId.');
    if (scope.tableId && !ctx.tables.roleOf(scope.tableId, user.id)) throw notFound('Mesa não encontrada.');
    if (scope.worldId && ctx.worlds.find(scope.worldId)?.ownerId !== user.id) throw notFound('Mundo não encontrado.');

    const part = await req.file({ limits: { fileSize: maxBytes, files: 1, fields: 0, parts: 1 } });
    if (!part) throw badRequest('Nenhum arquivo enviado.');
    const content = await part.toBuffer();
    if (part.file.truncated) throw new HttpError(413, `Arquivo maior que ${ctx.config.MAX_UPLOAD_MB} MB.`);
    if (!content.length) throw badRequest('Arquivo vazio.');

    const mime = detectFileType(content);
    if (!mime) throw new HttpError(415, 'Formato não aceito. Envie PNG, JPEG, GIF, WebP ou áudio (MP3, OGG, WAV, FLAC, M4A, WebM).');
    if (ctx.files.usedBytes(user.id) + content.length > ctx.config.USER_QUOTA_MB * 1024 * 1024) {
      throw new HttpError(413, 'Espaço de arquivos da conta esgotado.');
    }

    const record: FileRecord = {
      id: newId(),
      ownerId: user.id,
      tableId: scope.tableId ?? null,
      worldId: scope.worldId ?? null,
      mime,
      size: content.length,
      sha256: createHash('sha256').update(content).digest('hex'),
      createdAt: Date.now(),
    };
    await ctx.files.save(record, content);
    return reply.code(201).send({ file: { id: record.id, mime, size: record.size } });
  });

  app.get('/files/:id', async (req, reply) => {
    const { user } = requireAuth(req);
    const { id } = parse(fileParams, req.params);
    const file = ctx.files.find(id);
    const allowed =
      !!file &&
      (file.ownerId === user.id ||
        (!!file.tableId && !!ctx.tables.roleOf(file.tableId, user.id)) ||
        (!!file.worldId && ctx.tables.isMemberOfWorldTable(file.worldId, user.id)));
    // Sem permissão = 404 (não revela que o arquivo existe)
    if (!file || !allowed) throw notFound('Arquivo não encontrado.');
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
    const file = ctx.files.find(id);
    if (!file) throw notFound('Arquivo não encontrado.');
    const isGm = !!file.tableId && ctx.tables.roleOf(file.tableId, user.id) === 'gm';
    if (file.ownerId !== user.id && !isGm) {
      // Membro que pode ver mas não excluir recebe 403; os demais, 404
      const canSee = (!!file.tableId && !!ctx.tables.roleOf(file.tableId, user.id)) || (!!file.worldId && ctx.tables.isMemberOfWorldTable(file.worldId, user.id));
      throw canSee ? forbidden() : notFound('Arquivo não encontrado.');
    }
    await ctx.files.delete([file.id]);
    return reply.code(204).send();
  });
}
