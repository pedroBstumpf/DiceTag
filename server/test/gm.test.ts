import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, createTestServer, redeem, register, type TestServer } from './helpers';

/** Painel do Mestre (ADR-0007): só o dono, só as mesas dele, só contagens. */
let server: TestServer;

beforeEach(async () => {
  server = await createTestServer();
});
afterEach(async () => {
  await server.close();
});

const newTable = (cookie: string, name = 'Crônicas') =>
  call(server, cookie, 'POST', '/api/tables', { name, system: 'Sistema próprio', description: '', maxPlayers: 5, accent: '#4f86f7' });

describe('GET /api/gm/overview', () => {
  it('sem conta = 401', async () => {
    const res = await server.app.http.inject({ method: 'GET', url: '/api/gm/overview' });
    expect(res.statusCode).toBe(401);
  });

  it('convidado (jogador) = 403, mesmo participando de uma mesa', async () => {
    const gm = await register(server, 'gm@exemplo.com');
    const { table } = (await newTable(gm.cookie)).json();
    const { code } = (await call(server, gm.cookie, 'POST', `/api/tables/${table.id}/invites`)).json();
    const guest = await redeem(server, code, 'Aventureira');
    expect((await call(server, guest.cookie, 'GET', '/api/gm/overview')).statusCode).toBe(403);
  });

  it('lista só as mesas do próprio mestre, com contagens e sem conteúdo da partida', async () => {
    const gm = await register(server, 'gm@exemplo.com');
    const other = await register(server, 'outro@exemplo.com');
    const { table } = (await newTable(gm.cookie, 'Mesa do GM')).json();
    await newTable(other.cookie, 'Mesa alheia');

    // Um jogador entra e sobra um convite pendente
    const first = (await call(server, gm.cookie, 'POST', `/api/tables/${table.id}/invites`)).json().code;
    await redeem(server, first, 'Aventureira');
    await call(server, gm.cookie, 'POST', `/api/tables/${table.id}/invites`);

    const res = await call(server, gm.cookie, 'GET', '/api/gm/overview');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json();
    expect(body.tables.map((t: { name: string }) => t.name)).toEqual(['Mesa do GM']);
    expect(body.tables[0]).toMatchObject({ id: table.id, role: 'gm', players: 1, pendingInvites: 1, scenes: 0, online: 0, stateUpdatedAt: null });
    expect(typeof body.tables[0].worldName).toBe('string');
    expect(body.totals).toEqual({ tables: 1, players: 1, pendingInvites: 1, online: 0 });
    // Nada do estado da mesa nem dos membros vai na resposta
    expect(Object.keys(body.tables[0])).not.toContain('state');
    expect(JSON.stringify(body)).not.toContain('Aventureira');
  });

  it('convites cancelados ou vencidos não contam como pendentes', async () => {
    const gm = await register(server, 'gm@exemplo.com');
    const { table } = (await newTable(gm.cookie)).json();
    await call(server, gm.cookie, 'POST', `/api/tables/${table.id}/invites`);
    server.ctx.db.prepare('UPDATE table_invites SET expires_at = 1').run();
    expect((await call(server, gm.cookie, 'GET', '/api/gm/overview')).json().tables[0].pendingInvites).toBe(0);
    await call(server, gm.cookie, 'POST', `/api/tables/${table.id}/invites`);
    await call(server, gm.cookie, 'DELETE', `/api/tables/${table.id}/invites`);
    expect((await call(server, gm.cookie, 'GET', '/api/gm/overview')).json().tables[0].pendingInvites).toBe(0);
  });

  it('conta as cenas do estado gravado', async () => {
    const gm = await register(server, 'gm@exemplo.com');
    const { table } = (await newTable(gm.cookie)).json();
    server.ctx.tables.saveState(table.id, JSON.stringify({ scenes: [{ id: 'a' }, { id: 'b' }], entries: [] }), 1, 1234);
    const [summary] = (await call(server, gm.cookie, 'GET', '/api/gm/overview')).json().tables;
    expect(summary).toMatchObject({ scenes: 2, stateUpdatedAt: 1234 });
  });
});
