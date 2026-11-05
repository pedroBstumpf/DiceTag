import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { MAX_WORLDS } from '../../domain';
import { HttpError, badRequest, conflict, notFound, parse } from '../../lib/errors';
import { idSchema, newId } from '../../lib/ids';
import { unsafeJsonReason } from '../../lib/safe-json';
import { text } from '../../lib/schemas';
import { MAX_WORLD_ITEMS, type WorldRecord } from '../../repositories/worlds';
import type { RealtimeHub } from '../../realtime/hub';
import { requireAuth, requireOwner } from '../plugins/auth';

/** Tamanho máximo de um item do Worldbuild salvo (JSON). Documentos longos cabem com folga. */
const MAX_ITEM_BYTES = 2 * 1024 * 1024;

const nameBody = z.strictObject({ name: text(1, 60) });
// Parâmetros vêm do roteador (rotas aninhadas trazem outros): valida só os usados
const worldParams = z.object({ id: idSchema });
const itemParams = z.object({ id: idSchema, itemId: idSchema });
const deleteBody = z.strictObject({ ids: z.array(idSchema).min(1).max(1000) });

/**
 * Campos comuns de todo item do Worldbuild (`WorldItem` do front-end). Os demais campos variam
 * por tipo (conteúdo do documento, eventos da linha do tempo, ficha do NPC…) e passam pelos
 * limites de `safe-json`. Texto rico (HTML do Tiptap) é guardado como veio: quem exibe é o
 * editor Tiptap, que só monta os elementos do esquema dele (scripts e atributos de evento somem).
 */
const itemBody = z.looseObject({
  id: idSchema,
  type: z.enum(['folder', 'document', 'timeline', 'image', 'item', 'npc', 'race']),
  name: z.string().max(200),
  parentId: idSchema.nullable(),
  createdAt: z.number().int().min(0),
  updatedAt: z.number().int().min(0),
});

/**
 * /api/worlds — mundos da conta (até MAX_WORLDS) e os itens do Worldbuild de cada um.
 * Só o dono acessa; mundo de outra conta = 404.
 */
export async function worldRoutes(app: FastifyInstance, ctx: AppContext, hub: RealtimeHub): Promise<void> {
  /** Mundo da conta, numa consulta com o dono (404 se não existe ou é de outra pessoa). */
  const ownWorld = (req: FastifyRequest): WorldRecord => {
    const { user } = requireAuth(req);
    const { id } = parse(worldParams, req.params);
    const world = ctx.worlds.findOwned(id, user.id);
    if (!world) throw notFound('Mundo não encontrado.');
    return world;
  };

  // --- Mundos ----------------------------------------------------------------

  app.get('/worlds', async (req) => ({ worlds: ctx.worlds.listByOwner(requireAuth(req).user.id) }));

  app.post('/worlds', async (req, reply) => {
    const { user } = requireOwner(req);
    const { name } = parse(nameBody, req.body);
    if (ctx.worlds.countByOwner(user.id) >= MAX_WORLDS) throw conflict(`Limite de ${MAX_WORLDS} mundos atingido.`);
    const world: WorldRecord = { id: newId(), ownerId: user.id, name, createdAt: Date.now() };
    ctx.worlds.create(world);
    return reply.code(201).send({ world });
  });

  app.patch('/worlds/:id', async (req) => {
    const world = ownWorld(req);
    const { name } = parse(nameBody, req.body);
    ctx.worlds.rename(world.id, world.ownerId, name);
    return { world: { ...world, name } };
  });

  /** Excluir: só se nenhuma mesa se passa nele e se sobrar outro mundo. Apaga itens e arquivos. */
  app.delete('/worlds/:id', async (req, reply) => {
    const world = ownWorld(req);
    if (ctx.tables.countByWorld(world.id) > 0) throw conflict('Há mesas que se passam neste mundo.');
    if (ctx.worlds.countByOwner(world.ownerId) <= 1) throw conflict('Não é possível excluir o único mundo.');
    const fileIds = ctx.files.idsByWorld(world.id);
    ctx.worlds.delete(world.id, world.ownerId);
    await ctx.files.delete(fileIds);
    return reply.code(204).send();
  });

  // --- Itens do Worldbuild ------------------------------------------------------

  app.get('/worlds/:id/items', async (req) => {
    const world = ownWorld(req);
    return { items: ctx.worlds.listItems(world.id, world.ownerId) };
  });

  /** Cria ou substitui um item (o id da URL precisa ser o do corpo). */
  app.put('/worlds/:id/items/:itemId', { bodyLimit: MAX_ITEM_BYTES + 1024 }, async (req) => {
    const world = ownWorld(req);
    const { itemId } = parse(itemParams, req.params);
    const item = parse(itemBody, req.body);
    if (item.id !== itemId) throw badRequest('O id do item não confere.');
    const unsafe = unsafeJsonReason(item);
    if (unsafe) throw badRequest(`Item recusado: ${unsafe}.`);
    const json = JSON.stringify(item);
    if (json.length > MAX_ITEM_BYTES) throw new HttpError(413, 'Item grande demais.');
    if (!ctx.worlds.hasItem(world.id, itemId) && ctx.worlds.countItems(world.id) >= MAX_WORLD_ITEMS) {
      throw conflict(`Limite de ${MAX_WORLD_ITEMS} itens por mundo atingido.`);
    }
    ctx.worlds.upsertItem(world.id, world.ownerId, itemId, json, Date.now());
    hub.worldChanged(world.id);
    return { item };
  });

  app.delete('/worlds/:id/items/:itemId', async (req, reply) => {
    const world = ownWorld(req);
    const { itemId } = parse(itemParams, req.params);
    ctx.worlds.deleteItems(world.id, world.ownerId, [itemId]);
    hub.worldChanged(world.id);
    return reply.code(204).send();
  });

  /** Exclui vários itens de uma vez (ex.: pasta com todo o conteúdo). */
  app.post('/worlds/:id/items/delete', async (req) => {
    const world = ownWorld(req);
    const { ids } = parse(deleteBody, req.body);
    const deleted = ctx.worlds.deleteItems(world.id, world.ownerId, ids);
    hub.worldChanged(world.id);
    return { deleted };
  });
}
