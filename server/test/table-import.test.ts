import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, createTestServer, openSocket, redeem, register, type TestServer } from './helpers';

/**
 * Mesa trazida de uma cópia do navegador (PUT /tables/:id/state): só o dono do app, e nunca por
 * cima de uma mesa em uso.
 */

let server: TestServer;
let owner: { id: string; cookie: string };
let tableId: string;
let port: number;

const STATE = {
  activeSceneId: 's1',
  scenes: [{ id: 's1', name: 'Taverna', gridSize: 70, showGrid: true, tokens: [{ id: 't1', entryId: 'p1', x: 10, y: 20 }] }],
  entries: [{ id: 'p1', kind: 'character', name: 'Herói' }],
};

beforeEach(async () => {
  server = await createTestServer();
  await server.app.http.listen({ host: '127.0.0.1', port: 0 });
  port = (server.app.http.server.address() as AddressInfo).port;
  owner = await register(server, 'dono@exemplo.com', 'Dono');
  const res = await call(server, owner.cookie, 'POST', '/api/tables', { name: 'Trazida', system: '', description: '', maxPlayers: 5, accent: '#4f86f7' });
  tableId = res.json().table.id;
});
afterEach(() => server.close());

const put = (cookie: string, body: unknown, id = tableId) => call(server, cookie, 'PUT', `/api/tables/${id}/state`, body);

/** Convidado de verdade, que entra na mesa pelo link. */
async function guest(): Promise<{ id: string; cookie: string }> {
  const invite = await call(server, owner.cookie, 'POST', `/api/tables/${tableId}/invites`, {});
  return redeem(server, invite.json().code, 'Amiga');
}

describe('PUT /api/tables/:id/state', () => {
  it('grava o estado, e a sala abre com ele', async () => {
    expect((await put(owner.cookie, { state: STATE })).statusCode).toBe(204);
    const saved = server.ctx.tables.loadState(tableId);
    expect(saved?.version).toBe(1);
    expect(saved?.state).toMatchObject({ activeSceneId: 's1', entries: [{ id: 'p1', name: 'Herói' }] });

    const socket = await openSocket(port, tableId, owner.cookie);
    const welcome = await socket.next('welcome');
    expect(welcome.state.scenes[0].name).toBe('Taverna');
    expect(welcome.state.scenes[0].tokens[0].id).toBe('t1');
    socket.ws.close();
  });

  it('não sobrescreve uma mesa já importada', async () => {
    await put(owner.cookie, { state: STATE });
    const res = await put(owner.cookie, { state: { ...STATE, scenes: [] } });
    expect(res.statusCode).toBe(409);
    expect(server.ctx.tables.loadState(tableId)?.state).toMatchObject({ activeSceneId: 's1' });
  });

  it('não grava numa mesa com a sala aberta', async () => {
    const socket = await openSocket(port, tableId, owner.cookie);
    await socket.next('welcome');
    expect((await put(owner.cookie, { state: STATE })).statusCode).toBe(409);
    socket.ws.close();
  });

  it('convidado da mesa não grava', async () => {
    const friend = await guest();
    expect((await put(friend.cookie, { state: STATE })).statusCode).toBe(403);
    expect(server.ctx.tables.loadState(tableId)).toBeNull();
  });

  it('sem conta não grava', async () => {
    expect((await put('', { state: STATE })).statusCode).toBe(401);
  });

  it('mesa que não existe responde 404', async () => {
    expect((await put(owner.cookie, { state: STATE }, 'mesa-inexistente')).statusCode).toBe(404);
  });

  it('recusa formatos que quebrariam a sala', async () => {
    const bad = [
      {},
      { state: {} },
      { state: { ...STATE, scenes: 'x' } },
      { state: { ...STATE, entries: [{ id: 'p1', kind: 'desconhecido' }] } },
      { state: { ...STATE, scenes: [{ id: '../fora' }] } },
      { state: { ...STATE, scenes: [{ id: 's1', tokens: 'x' }] } },
      { state: STATE, extra: 1 },
    ];
    for (const body of bad) expect((await put(owner.cookie, body)).statusCode, JSON.stringify(body)).toBe(400);
    expect(server.ctx.tables.loadState(tableId)).toBeNull();
  });

  it('recusa chaves proibidas escondidas no estado', async () => {
    const body = `{"state":{"scenes":[],"entries":[],"lore":{"constructor":{"x":1}}}}`;
    const res = await call(server, owner.cookie, 'PUT', `/api/tables/${tableId}/state`, JSON.parse(body));
    expect(res.statusCode).toBe(400);
    expect(server.ctx.tables.loadState(tableId)).toBeNull();
  });
});
