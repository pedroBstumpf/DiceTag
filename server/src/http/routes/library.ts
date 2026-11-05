import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { audit } from '../../lib/audit';
import { HttpError, badRequest, parse } from '../../lib/errors';
import { requireOwner } from '../plugins/auth';

const MB = 1024 * 1024;
const pathQuery = z.strictObject({ path: z.string().min(1).max(1024) });
const folderQuery = z.strictObject({ folder: z.string().min(1).max(1024) });
const pathBody = z.strictObject({ path: z.string().min(1).max(1024) });
const moveBody = z.strictObject({ from: z.string().min(1).max(1024), to: z.string().min(1).max(1024) });
/** O dono envia pastas inteiras de uma vez: limite próprio, bem acima do geral de envios. */
const LIBRARY_RATE_LIMIT = { rateLimit: { max: 1200, timeWindow: '1 minute' } };

/**
 * /api/library — a biblioteca de arquivos do dono (ver `services/library.service.ts`).
 * **Só o dono do app:** todas as rotas exigem a conta dele, inclusive para listar.
 */
export async function libraryRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.addHook('preHandler', async (req) => {
    requireOwner(req);
  });

  app.get('/library', { config: LIBRARY_RATE_LIMIT }, async () => ({
    root: ctx.library.root,
    maxUploadMb: ctx.config.LIBRARY_MAX_UPLOAD_MB,
    // Esta execução está sob o modelo de permissões do Node? (`npm run mesa`)
    sandboxed: !!process.permission,
    ...(await ctx.library.list()),
  }));

  app.get('/library/file', { config: LIBRARY_RATE_LIMIT }, async (req, reply) => {
    const { path } = parse(pathQuery, req.query);
    const { stream, mime, size } = await ctx.library.read(path);
    return reply
      .header('Content-Type', mime)
      .header('Content-Length', size)
      .header('Content-Disposition', 'inline; filename="arquivo"')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, no-cache')
      .send(stream);
  });

  app.post('/library/folders', { config: LIBRARY_RATE_LIMIT }, async (req, reply) => {
    const { path } = parse(pathBody, req.body);
    return reply.code(201).send({ entry: await ctx.library.createFolder(path) });
  });

  /** Um arquivo por requisição, em streaming; a tela envia vários em sequência. */
  app.post('/library/files', { config: LIBRARY_RATE_LIMIT }, async (req, reply) => {
    const { user } = requireOwner(req);
    const { folder } = parse(folderQuery, req.query);
    const maxBytes = ctx.config.LIBRARY_MAX_UPLOAD_MB * MB;
    const part = await req.file({ limits: { fileSize: maxBytes, files: 1, fields: 0, parts: 1 } });
    if (!part) throw badRequest('Nenhum arquivo enviado.');
    try {
      const entry = await ctx.library.receive(folder, part.file, part.filename, part.mimetype, maxBytes);
      return await reply.code(201).send({ entry });
    } catch (err) {
      if (err instanceof HttpError) audit(req.log, 'upload.recusado', { userId: user.id, status: err.statusCode, motivo: err.message });
      throw err;
    }
  });

  app.post('/library/move', { config: LIBRARY_RATE_LIMIT }, async (req, reply) => {
    const { from, to } = parse(moveBody, req.body);
    await ctx.library.move(from, to);
    return reply.code(204).send();
  });

  app.post('/library/delete', { config: LIBRARY_RATE_LIMIT }, async (req, reply) => {
    const { path } = parse(pathBody, req.body);
    await ctx.library.remove(path);
    return reply.code(204).send();
  });
}
