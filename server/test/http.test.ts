import { readdirSync } from 'node:fs';
import { Writable } from 'node:stream';
import type { InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env';
import type { MailMessage } from '../src/services/mailer';
import { ORIGIN, PASSWORD, PNG_1X1, call, createTestServer, multipart, redeem, register, sessionCookie, type TestServer } from './helpers';

let server: TestServer;
beforeEach(async () => {
  server = await createTestServer();
});
afterEach(async () => {
  await server.close();
});

const inject = (opts: InjectOptions) => server.app.http.inject(opts);
const newTable = (cookie: string, extra = {}) =>
  call(server, cookie, 'POST', '/api/tables', { name: 'Mesa', system: '', description: '', maxPlayers: 2, accent: '#4f86f7', ...extra });

// --- Contas --------------------------------------------------------------------------

describe('contas e sessão', () => {
  it('não há cadastro público: a rota não existe', async () => {
    const res = await inject({ method: 'POST', url: '/api/auth/register', headers: { origin: ORIGIN }, payload: { name: 'Ana', email: 'ana@exemplo.com', password: PASSWORD } });
    expect(res.statusCode).toBe(404);
    expect(server.ctx.users.owner()).toBeNull();
  });

  it('login cria sessão com cookie HttpOnly, Secure e SameSite=Strict, sem token no corpo', async () => {
    await server.ctx.auth.createAccount({ name: 'Ana', email: 'ana@exemplo.com', password: PASSWORD }, 'owner');
    const res = await inject({ method: 'POST', url: '/api/auth/login', headers: { origin: ORIGIN }, payload: { email: 'Ana@Exemplo.com ', password: PASSWORD } });
    expect(res.statusCode).toBe(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/^__Host-zh_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(res.json().user).toEqual({ id: expect.any(String), name: 'Ana', email: 'ana@exemplo.com', kind: 'owner', createdAt: expect.any(Number) });
    expect(res.body).not.toContain(sessionCookie(res).split('=')[1]);
    expect(res.body).not.toMatch(/password|hash/i);
  });

  it('a conta do dono já nasce com o primeiro mundo', async () => {
    const { cookie } = await register(server, 'a@exemplo.com');
    const res = await call(server, cookie, 'GET', '/api/worlds');
    expect(res.json().worlds).toHaveLength(1);
  });

  it('o dono recusa senha fraca e e-mail repetido', async () => {
    await expect(server.ctx.auth.createAccount({ name: 'A', email: 'a@exemplo.com', password: '12345678' }, 'owner')).rejects.toThrow();
    await register(server, 'a@exemplo.com');
    await expect(server.ctx.auth.createAccount({ name: 'B', email: 'a@exemplo.com', password: PASSWORD }, 'owner')).rejects.toThrow(/e-mail/);
  });

  it('login: mesma resposta para e-mail inexistente e senha errada', async () => {
    await register(server, 'a@exemplo.com');
    const wrong = await inject({ method: 'POST', url: '/api/auth/login', headers: { origin: ORIGIN }, payload: { email: 'a@exemplo.com', password: 'errada-123' } });
    const missing = await inject({ method: 'POST', url: '/api/auth/login', headers: { origin: ORIGIN }, payload: { email: 'b@exemplo.com', password: 'errada-123' } });
    expect(wrong.statusCode).toBe(401);
    expect(missing.statusCode).toBe(401);
    expect(wrong.json()).toEqual(missing.json());
  });

  it('depois de 5 senhas erradas, o mesmo IP espera; de outro IP a conta não fica trancada', async () => {
    await register(server, 'a@exemplo.com');
    const attempt = (password: string, remoteAddress = '203.0.113.1') =>
      inject({ method: 'POST', url: '/api/auth/login', remoteAddress, headers: { origin: ORIGIN }, payload: { email: 'a@exemplo.com', password } });
    for (let i = 0; i < 5; i++) expect((await attempt('errada-123')).statusCode).toBe(401);
    expect((await attempt(PASSWORD)).statusCode).toBe(429);
    // A dona da conta, de outro IP, entra normalmente
    expect((await attempt(PASSWORD, '198.51.100.7')).statusCode).toBe(200);
  });

  it('logout encerra a sessão no servidor (o cookie antigo deixa de valer)', async () => {
    const { cookie } = await register(server, 'a@exemplo.com');
    expect((await call(server, cookie, 'GET', '/api/auth/me')).statusCode).toBe(200);
    expect((await call(server, cookie, 'POST', '/api/auth/logout')).statusCode).toBe(204);
    expect((await call(server, cookie, 'GET', '/api/auth/me')).statusCode).toBe(401);
  });

  it('trocar a senha encerra todas as sessões e dá uma nova a quem trocou', async () => {
    const { cookie } = await register(server, 'a@exemplo.com');
    const login = await inject({ method: 'POST', url: '/api/auth/login', headers: { origin: ORIGIN }, payload: { email: 'a@exemplo.com', password: PASSWORD } });
    const other = sessionCookie(login);
    const res = await call(server, cookie, 'POST', '/api/auth/password', { current: PASSWORD, next: 'outra senha bem longa' });
    expect(res.statusCode).toBe(204);
    const renewed = sessionCookie(res);
    expect(renewed).not.toBe(cookie);
    expect((await call(server, other, 'GET', '/api/auth/me')).statusCode).toBe(401);
    expect((await call(server, cookie, 'GET', '/api/auth/me')).statusCode).toBe(401);
    expect((await call(server, renewed, 'GET', '/api/auth/me')).statusCode).toBe(200);
  });

  it('sair de todos os dispositivos encerra todas as sessões, inclusive a atual', async () => {
    const { cookie } = await register(server, 'a@exemplo.com');
    const login = await inject({ method: 'POST', url: '/api/auth/login', headers: { origin: ORIGIN }, payload: { email: 'a@exemplo.com', password: PASSWORD } });
    const other = sessionCookie(login);
    expect((await call(server, cookie, 'POST', '/api/auth/logout-all')).statusCode).toBe(204);
    expect((await call(server, other, 'GET', '/api/auth/me')).statusCode).toBe(401);
    expect((await call(server, cookie, 'GET', '/api/auth/me')).statusCode).toBe(401);
  });

  it('cookie forjado ou ausente = 401', async () => {
    expect((await call(server, '__Host-zh_session=inventado', 'GET', '/api/auth/me')).statusCode).toBe(401);
    expect((await inject({ method: 'GET', url: '/api/tables' })).statusCode).toBe(401);
  });

  it('negar por padrão: toda rota exige sessão, menos as públicas da lista', async () => {
    // Rota nova sem nenhuma marca: nasce protegida
    server.app.http.get('/api/rota-nova', async () => ({ segredo: true }));
    for (const [method, url] of [
      ['GET', '/api/rota-nova'],
      ['GET', '/api/tables'],
      ['POST', '/api/tables'],
      ['GET', '/api/worlds'],
      ['PUT', '/api/worlds/w/items/i'],
      ['GET', '/api/files/f'],
      ['POST', '/api/invites/accept'],
      ['PATCH', '/api/auth/me'],
    ] as const) {
      expect((await inject({ method, url, headers: { origin: ORIGIN } })).statusCode, url).toBe(401);
    }
    expect((await inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    expect((await inject({ method: 'POST', url: '/api/auth/logout', headers: { origin: ORIGIN } })).statusCode).toBe(204);
    expect((await inject({ method: 'GET', url: '/api/nao-existe' })).statusCode).toBe(404);
  });
});

// --- Proteções gerais -------------------------------------------------------------------

describe('proteções HTTP', () => {
  it('CSRF: alteração sem origem ou de outra origem = 403', async () => {
    const { cookie } = await register(server, 'a@exemplo.com');
    const noOrigin = await inject({ method: 'POST', url: '/api/tables', headers: { cookie }, payload: {} });
    const evil = await inject({ method: 'POST', url: '/api/tables', headers: { cookie, origin: 'https://evil.example' }, payload: {} });
    expect(noOrigin.statusCode).toBe(403);
    expect(evil.statusCode).toBe(403);
  });

  it('só JSON no corpo (text/plain de formulário é recusado)', async () => {
    const res = await inject({ method: 'POST', url: '/api/auth/login', headers: { origin: ORIGIN, 'content-type': 'text/plain' }, payload: '{}' });
    expect(res.statusCode).toBe(415);
  });

  it('JSON com __proto__ é recusado', async () => {
    const res = await inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: '{"email":"a@b.co","password":"x","__proto__":{"admin":true}}',
    });
    expect(res.statusCode).toBe(400);
  });

  it('cabeçalhos de segurança e CORS só para origens permitidas', async () => {
    const res = await inject({ method: 'GET', url: '/api/health', headers: { origin: ORIGIN } });
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers['x-powered-by']).toBeUndefined();
    const evil = await inject({ method: 'GET', url: '/api/health', headers: { origin: 'https://evil.example' } });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('erros não vazam detalhes internos nem ecoam valores enviados', async () => {
    const res = await inject({ method: 'POST', url: '/api/auth/login', headers: { origin: ORIGIN }, payload: { email: 'não-é-email', password: PASSWORD } });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('não-é-email');
    expect(res.body).not.toContain(PASSWORD);
    expect(res.body).not.toMatch(/at .*\.ts/);
  });

  it('página de testes não existe sem DEV_TOOLS', async () => {
    expect((await inject({ method: 'GET', url: '/dev/' })).statusCode).toBe(404);
  });
});

describe('limite de requisições', () => {
  it('rotas de login: 10 por minuto por IP', async () => {
    const limited = await createTestServer({ RATE_LIMIT: 'true' });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 12; i++) {
        const res = await limited.app.http.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: ORIGIN }, payload: { email: `x${i}@b.co`, password: 'errada-123' } });
        codes.push(res.statusCode);
      }
      expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
      expect(codes.slice(10)).toEqual([429, 429]);
    } finally {
      await limited.close();
    }
  });
});

describe('registro de eventos de segurança', () => {
  it('login com falha, permissão negada e erro interno vão para o log, sem segredos', async () => {
    const lines: string[] = [];
    const logStream = new Writable({
      write(chunk, _encoding, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    const logged = await createTestServer({ LOG_LEVEL: 'info' }, { logStream });
    logged.app.http.get('/api/quebra', async () => {
      throw new Error('detalhe interno do servidor');
    });
    try {
      const user = await register(logged, 'pessoa@exemplo.com');
      const wrong = 'senha-errada-' + PASSWORD;
      await logged.app.http.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: ORIGIN }, payload: { email: 'pessoa@exemplo.com', password: wrong } });
      await logged.app.http.inject({ method: 'POST', url: '/api/tables', headers: { cookie: user.cookie }, payload: {} });
      const crash = await call(logged, user.cookie, 'GET', '/api/quebra');

      expect(crash.statusCode).toBe(500);
      expect(crash.json().requestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(crash.body).not.toContain('detalhe interno');
      expect(lines.some((l) => l.includes(crash.json().requestId) && l.includes('detalhe interno'))).toBe(true);

      const events = lines.map((l) => JSON.parse(l) as { security?: string; emailRef?: string }).filter((e) => e.security);
      expect(events.map((e) => e.security)).toEqual(expect.arrayContaining(['login.ok', 'login.falha', 'permissao.negada']));
      expect(events.find((e) => e.security === 'login.falha')?.emailRef).toMatch(/^[0-9a-f]{16}$/);
      const all = lines.join('\n');
      for (const secret of [PASSWORD, wrong, 'pessoa@exemplo.com', user.cookie.split('=')[1]]) expect(all).not.toContain(secret);
    } finally {
      await logged.close();
    }
  });
});

// --- Mesas ----------------------------------------------------------------------------------

describe('mesas, membros e convites', () => {
  it('mesa de outra conta é invisível (404), não "proibida"', async () => {
    const gm = await register(server, 'gm@exemplo.com');
    const other = await register(server, 'outro@exemplo.com');
    const { table } = (await newTable(gm.cookie)).json();
    expect((await call(server, other.cookie, 'GET', `/api/tables/${table.id}`)).statusCode).toBe(404);
    expect((await call(server, other.cookie, 'DELETE', `/api/tables/${table.id}`)).statusCode).toBe(404);
    expect((await call(server, other.cookie, 'GET', '/api/tables')).json().tables).toEqual([]);
  });

  it('não cria mesa em mundo de outra conta', async () => {
    const a = await register(server, 'a@exemplo.com');
    const b = await register(server, 'b@exemplo.com');
    const worldB = (await call(server, b.cookie, 'GET', '/api/worlds')).json().worlds[0].id;
    expect((await newTable(a.cookie, { worldId: worldB })).statusCode).toBe(404);
  });

  it('convite: jogador entra, vê a mesa, não edita; limite de jogadores', async () => {
    const gm = await register(server, 'gm@exemplo.com');
    const p1 = await register(server, 'p1@exemplo.com');
    const p2 = await register(server, 'p2@exemplo.com');
    const p3 = await register(server, 'p3@exemplo.com');
    const { table } = (await newTable(gm.cookie)).json();
    const { code } = (await call(server, gm.cookie, 'POST', `/api/tables/${table.id}/invites`)).json();
    expect((await call(server, p1.cookie, 'POST', `/api/tables/${table.id}/invites`)).statusCode).toBe(404);

    const newCode = async () => (await call(server, gm.cookie, 'POST', `/api/tables/${table.id}/invites`)).json().code;
    expect((await call(server, p1.cookie, 'POST', '/api/invites/accept', { code })).json().table.role).toBe('player');
    // O convite é de uso único: já usado, é "inválido"
    expect((await call(server, p2.cookie, 'POST', '/api/invites/accept', { code })).statusCode).toBe(404);
    expect((await call(server, p2.cookie, 'POST', '/api/invites/accept', { code: await newCode() })).statusCode).toBe(200);
    // Com convite novo, a mesa cheia recusa
    expect((await call(server, p3.cookie, 'POST', '/api/invites/accept', { code: await newCode() })).statusCode).toBe(409);
    expect((await call(server, p1.cookie, 'PATCH', `/api/tables/${table.id}`, { name: 'Minha' })).statusCode).toBe(403);
    expect((await call(server, p1.cookie, 'GET', `/api/tables/${table.id}/members`)).json().members).toHaveLength(3);
  });

  it('convite inválido ou cancelado = 404', async () => {
    const gm = await register(server, 'gm@exemplo.com');
    const p1 = await register(server, 'p1@exemplo.com');
    const { table } = (await newTable(gm.cookie)).json();
    const { code } = (await call(server, gm.cookie, 'POST', `/api/tables/${table.id}/invites`)).json();
    expect((await call(server, p1.cookie, 'POST', '/api/invites/accept', { code: 'codigo-que-nao-existe' })).statusCode).toBe(404);
    await call(server, gm.cookie, 'DELETE', `/api/tables/${table.id}/invites`);
    expect((await call(server, p1.cookie, 'POST', '/api/invites/accept', { code })).statusCode).toBe(404);
  });

  it('repositórios conferem dono e participação na própria consulta (não só nas rotas)', async () => {
    const a = await register(server, 'a@exemplo.com');
    const b = await register(server, 'b@exemplo.com');
    const { worlds, tables } = server.ctx;
    const world = worlds.listByOwner(a.id)[0];
    expect(worlds.findOwned(world.id, b.id)).toBeNull();
    expect(worlds.rename(world.id, b.id, 'Roubado')).toBe(false);
    expect(worlds.upsertItem(world.id, b.id, 'doc', '{}', 0)).toBe(false);
    expect(worlds.deleteItems(world.id, b.id, ['doc'])).toBe(0);
    expect(worlds.delete(world.id, b.id)).toBe(false);
    expect(worlds.listItems(world.id, b.id)).toEqual([]);

    const { table } = (await newTable(a.cookie)).json();
    expect(tables.findForMember(table.id, b.id)).toBeNull();
    expect(tables.update(table.id, b.id, { name: 'Roubada' })).toBe(false);
    expect(tables.createInvite('hash', table.id, b.id, 0, 1, 1)).toBe(false);
    expect(tables.members(table.id, b.id)).toEqual([]);
    expect(tables.delete(table.id, b.id)).toBe(false);
    expect(worlds.listItemsForMember(table.id, b.id)).toEqual([]);
    // O mestre nunca sai da mesa pela remoção de jogadores
    expect(tables.removePlayer(table.id, a.id)).toBe(false);
    expect(tables.findForMember(table.id, a.id)?.name).toBe('Mesa');
  });

  it('jogador sai; mestre remove; dono não sai', async () => {
    const gm = await register(server, 'gm@exemplo.com');
    const p1 = await register(server, 'p1@exemplo.com');
    const { table } = (await newTable(gm.cookie)).json();
    const { code } = (await call(server, gm.cookie, 'POST', `/api/tables/${table.id}/invites`)).json();
    await call(server, p1.cookie, 'POST', '/api/invites/accept', { code });
    expect((await call(server, p1.cookie, 'DELETE', `/api/tables/${table.id}/members/${gm.id}`)).statusCode).toBe(403);
    expect((await call(server, p1.cookie, 'DELETE', `/api/tables/${table.id}/members/${p1.id}`)).statusCode).toBe(204);
    expect((await call(server, p1.cookie, 'GET', `/api/tables/${table.id}`)).statusCode).toBe(404);
  });
});

// --- Mundos ------------------------------------------------------------------------------------

describe('mundos e Worldbuild', () => {
  it('até 2 mundos; não exclui o único nem um usado por mesa', async () => {
    const { cookie } = await register(server, 'a@exemplo.com');
    const first = (await call(server, cookie, 'GET', '/api/worlds')).json().worlds[0];
    expect((await call(server, cookie, 'DELETE', `/api/worlds/${first.id}`)).statusCode).toBe(409);
    const second = (await call(server, cookie, 'POST', '/api/worlds', { name: 'Outro' })).json().world;
    expect((await call(server, cookie, 'POST', '/api/worlds', { name: 'Terceiro' })).statusCode).toBe(409);
    await newTable(cookie, { worldId: second.id });
    expect((await call(server, cookie, 'DELETE', `/api/worlds/${second.id}`)).statusCode).toBe(409);
  });

  it('itens: salva, lista e recusa conteúdo perigoso; mundo de outra conta = 404', async () => {
    const a = await register(server, 'a@exemplo.com');
    const b = await register(server, 'b@exemplo.com');
    const world = (await call(server, a.cookie, 'GET', '/api/worlds')).json().worlds[0];
    const item = { id: 'doc-1', type: 'document', name: 'Lenda', parentId: null, createdAt: 1, updatedAt: 1, content: '<p>Era uma vez</p>' };
    expect((await call(server, a.cookie, 'PUT', `/api/worlds/${world.id}/items/doc-1`, item)).statusCode).toBe(200);
    expect((await call(server, a.cookie, 'GET', `/api/worlds/${world.id}/items`)).json().items).toEqual([item]);
    expect((await call(server, a.cookie, 'PUT', `/api/worlds/${world.id}/items/outro`, item)).statusCode).toBe(400);
    expect((await call(server, a.cookie, 'PUT', `/api/worlds/${world.id}/items/doc-2`, { ...item, id: 'doc-2', type: 'script' })).statusCode).toBe(400);
    expect((await call(server, b.cookie, 'GET', `/api/worlds/${world.id}/items`)).statusCode).toBe(404);
    expect((await call(server, b.cookie, 'PUT', `/api/worlds/${world.id}/items/doc-1`, item)).statusCode).toBe(404);
  });
});

// --- Arquivos ---------------------------------------------------------------------------------

describe('arquivos', () => {
  const upload = (cookie: string, query: string, content: Buffer, filename?: string, type?: string) => {
    const form = multipart(content, filename, type);
    return inject({ method: 'POST', url: `/api/files?${query}`, headers: { cookie, origin: ORIGIN, 'content-type': form.contentType }, payload: form.body });
  };

  it('aceita PNG e serve com tipo detectado, nosniff e CSP sandbox; só membros baixam', async () => {
    const gm = await register(server, 'gm@exemplo.com');
    const stranger = await register(server, 'x@exemplo.com');
    const { table } = (await newTable(gm.cookie)).json();
    const res = await upload(gm.cookie, `tableId=${table.id}`, PNG_1X1, 'mapa.png');
    expect(res.statusCode).toBe(201);
    const { file } = res.json();
    expect(file.mime).toBe('image/png');

    const download = await call(server, gm.cookie, 'GET', `/api/files/${file.id}`);
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toBe('image/png');
    expect(download.headers['x-content-type-options']).toBe('nosniff');
    expect(download.headers['content-security-policy']).toContain('sandbox');
    expect(download.rawPayload.equals(PNG_1X1)).toBe(true);

    expect((await call(server, stranger.cookie, 'GET', `/api/files/${file.id}`)).statusCode).toBe(404);
    expect((await call(server, stranger.cookie, 'DELETE', `/api/files/${file.id}`)).statusCode).toBe(404);
  });

  it('excluir arquivo: quem enviou ou o mestre da mesa; outro membro 403; quem não participa 404', async () => {
    const gm = await register(server, 'gm@exemplo.com');
    const p1 = await register(server, 'p1@exemplo.com');
    const p2 = await register(server, 'p2@exemplo.com');
    const stranger = await register(server, 'x@exemplo.com');
    const { table } = (await newTable(gm.cookie, { maxPlayers: 3 })).json();
    const { code } = (await call(server, gm.cookie, 'POST', `/api/tables/${table.id}/invites`)).json();
    await call(server, p1.cookie, 'POST', '/api/invites/accept', { code });
    const second = (await call(server, gm.cookie, 'POST', `/api/tables/${table.id}/invites`)).json().code;
    await call(server, p2.cookie, 'POST', '/api/invites/accept', { code: second });
    const mine = (await upload(p1.cookie, `tableId=${table.id}`, PNG_1X1)).json().file;
    const other = (await upload(p1.cookie, `tableId=${table.id}`, PNG_1X1)).json().file;

    expect((await call(server, p2.cookie, 'GET', `/api/files/${mine.id}`)).statusCode).toBe(200);
    expect((await call(server, p2.cookie, 'DELETE', `/api/files/${mine.id}`)).statusCode).toBe(403);
    expect((await call(server, stranger.cookie, 'DELETE', `/api/files/${mine.id}`)).statusCode).toBe(404);
    expect((await call(server, p1.cookie, 'DELETE', `/api/files/${mine.id}`)).statusCode).toBe(204);
    expect((await call(server, gm.cookie, 'DELETE', `/api/files/${other.id}`)).statusCode).toBe(204);
    expect((await call(server, gm.cookie, 'GET', `/api/files/${other.id}`)).statusCode).toBe(404);
  });

  it('recusa SVG com script mesmo com nome .png e Content-Type de imagem', async () => {
    const { cookie } = await register(server, 'gm@exemplo.com');
    const { table } = (await newTable(cookie)).json();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
    expect((await upload(cookie, `tableId=${table.id}`, svg, 'mapa.png', 'image/png')).statusCode).toBe(415);
  });

  it('nome e tipo declarado precisam conferir com o conteúdo', async () => {
    const { cookie } = await register(server, 'gm@exemplo.com');
    const { table } = (await newTable(cookie)).json();
    const scope = `tableId=${table.id}`;
    expect((await upload(cookie, scope, PNG_1X1, 'mapa.exe')).statusCode).toBe(415);
    expect((await upload(cookie, scope, PNG_1X1, 'mapa.svg', 'image/svg+xml')).statusCode).toBe(415);
    expect((await upload(cookie, scope, PNG_1X1, 'mapa.png', 'text/html')).statusCode).toBe(415);
    expect((await upload(cookie, scope, PNG_1X1, 'mapa', 'image/png')).statusCode).toBe(415);
    // Navegador sem tipo conhecido manda octet-stream: vale o conteúdo + a extensão
    expect((await upload(cookie, scope, PNG_1X1, 'MAPA.PNG', 'application/octet-stream')).statusCode).toBe(201);
  });

  it('cota da mesa: dois envios simultâneos não passam juntos; recusados não deixam temporários', async () => {
    const small = await createTestServer({ TABLE_QUOTA_MB: '1' });
    try {
      const gm = await register(small, 'gm@exemplo.com');
      const { table } = (await call(small, gm.cookie, 'POST', '/api/tables', { name: 'M', system: '', description: '', maxPlayers: 2, accent: '#4f86f7' })).json();
      const piece = Buffer.concat([PNG_1X1, Buffer.alloc(600 * 1024)]);
      const send = () => {
        const form = multipart(piece);
        const headers = { cookie: gm.cookie, origin: ORIGIN, 'content-type': form.contentType };
        return small.app.http.inject({ method: 'POST', url: `/api/files?tableId=${table.id}`, headers, payload: form.body });
      };
      const results = await Promise.all([send(), send()]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([201, 413]);
      expect(readdirSync(small.config.FILES_DIR)).toHaveLength(1);
    } finally {
      await small.close();
    }
  });

  it('recusa arquivo grande demais e envio em mesa de outra conta', async () => {
    const small = await createTestServer({ MAX_UPLOAD_MB: '1' });
    try {
      const gm = await register(small, 'gm@exemplo.com');
      const other = await register(small, 'x@exemplo.com');
      const { table } = (await call(small, gm.cookie, 'POST', '/api/tables', { name: 'M', system: '', description: '', maxPlayers: 2, accent: '#4f86f7' })).json();
      const big = Buffer.concat([PNG_1X1, Buffer.alloc(1024 * 1024 + 10)]);
      const form = multipart(big);
      const res = await small.app.http.inject({ method: 'POST', url: `/api/files?tableId=${table.id}`, headers: { cookie: gm.cookie, origin: ORIGIN, 'content-type': form.contentType }, payload: form.body });
      expect(res.statusCode).toBe(413);
      const form2 = multipart(PNG_1X1);
      const res2 = await small.app.http.inject({ method: 'POST', url: `/api/files?tableId=${table.id}`, headers: { cookie: other.cookie, origin: ORIGIN, 'content-type': form2.contentType }, payload: form2.body });
      expect(res2.statusCode).toBe(404);
    } finally {
      await small.close();
    }
  });

  it('excluir a mesa apaga os arquivos dela', async () => {
    const { cookie } = await register(server, 'gm@exemplo.com');
    const { table } = (await newTable(cookie)).json();
    const { file } = (await upload(cookie, `tableId=${table.id}`, PNG_1X1)).json();
    expect((await call(server, cookie, 'DELETE', `/api/tables/${table.id}`)).statusCode).toBe(204);
    expect((await call(server, cookie, 'GET', `/api/files/${file.id}`)).statusCode).toBe(404);
  });
});

describe('recuperação de senha', () => {
  let server: TestServer;
  let sent: MailMessage[];
  const account = 'pessoa@exemplo.com';
  const forgot = (email: string) => server.app.http.inject({ method: 'POST', url: '/api/auth/password/forgot', headers: { origin: ORIGIN }, payload: { email } });
  const reset = (token: string, password: string, origin = ORIGIN) => server.app.http.inject({ method: 'POST', url: '/api/auth/password/reset', headers: { origin }, payload: { token, password } });
  const login = (password: string) => server.app.http.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: ORIGIN }, payload: { email: account, password } });
  const tokenOf = (mail: MailMessage) => /#token=([\w-]+)/.exec(mail.text)![1];
  const NEW_PASSWORD = 'uma frase bem diferente';

  beforeEach(async () => {
    server = await createTestServer();
    sent = [];
    server.ctx.mailer = { enabled: true, send: async (m) => void sent.push(m) };
    await register(server, account, 'Pessoa');
  });
  afterEach(() => server.close());

  it('a resposta é a mesma para e-mail com e sem conta, e só quem tem conta recebe', async () => {
    const yes = await forgot(account);
    const no = await forgot('ninguem@exemplo.com');
    expect(yes.statusCode).toBe(202);
    expect(no.statusCode).toBe(202);
    expect(yes.body).toBe(no.body);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(account);
  });

  it('o link usa o endereço da configuração, nunca o cabeçalho Host da requisição', async () => {
    await server.app.http.inject({ method: 'POST', url: '/api/auth/password/forgot', headers: { origin: ORIGIN, host: 'site-malicioso.example' }, payload: { email: account } });
    expect(sent[0].text).toContain(`${ORIGIN}/redefinir-senha#token=`);
    expect(sent[0].text).not.toContain('site-malicioso');
  });

  it('o banco guarda só o hash do token', async () => {
    await forgot(account);
    const rows = server.ctx.db.prepare('SELECT token_hash FROM password_resets').all() as { token_hash: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toBe(tokenOf(sent[0]));
    expect(rows[0].token_hash).not.toContain(tokenOf(sent[0]));
  });

  it('redefine a senha: a antiga para de valer, a nova entra, e todas as sessões caem', async () => {
    const { cookie } = await register(server, 'outra@exemplo.com');
    void cookie;
    const session = await login(PASSWORD);
    const sid = sessionCookie(session);
    await forgot(account);
    expect((await reset(tokenOf(sent[0]), NEW_PASSWORD)).statusCode).toBe(204);
    expect((await call(server, sid, 'GET', '/api/auth/me')).statusCode).toBe(401);
    expect((await login(PASSWORD)).statusCode).toBe(401);
    expect((await login(NEW_PASSWORD)).statusCode).toBe(200);
  });

  it('o link só vale uma vez', async () => {
    await forgot(account);
    expect((await reset(tokenOf(sent[0]), NEW_PASSWORD)).statusCode).toBe(204);
    expect((await reset(tokenOf(sent[0]), 'outra frase qualquer')).statusCode).toBe(400);
  });

  it('o link vence, e token inventado não vale', async () => {
    await forgot(account);
    server.ctx.db.prepare('UPDATE password_resets SET expires_at = 1').run();
    expect((await reset(tokenOf(sent[0]), NEW_PASSWORD)).statusCode).toBe(400);
    expect((await reset('a'.repeat(43), NEW_PASSWORD)).statusCode).toBe(400);
    expect((await login(PASSWORD)).statusCode).toBe(200);
  });

  it('senha fora da política é recusada sem gastar o link', async () => {
    await forgot(account);
    expect((await reset(tokenOf(sent[0]), '123')).statusCode).toBe(400);
    expect((await reset(tokenOf(sent[0]), account)).statusCode).toBe(400);
    expect((await reset(tokenOf(sent[0]), NEW_PASSWORD)).statusCode).toBe(204);
  });

  it('pedidos seguidos não enchem a caixa de e-mail de ninguém', async () => {
    await forgot(account);
    await forgot(account);
    await forgot(account);
    expect(sent).toHaveLength(1);
  });

  it('outra origem é recusada (CSRF), como nas demais alterações', async () => {
    await forgot(account);
    expect((await reset(tokenOf(sent[0]), NEW_PASSWORD, 'https://site-malicioso.example')).statusCode).toBe(403);
  });

  it('sem serviço de e-mail, a resposta é igual e nenhum token é criado; quem administra gera o link', async () => {
    server.ctx.mailer = { enabled: false, send: async () => undefined };
    expect((await forgot(account)).statusCode).toBe(202);
    expect(server.ctx.db.prepare('SELECT COUNT(*) AS n FROM password_resets').get()).toEqual({ n: 0 });
    const made = server.ctx.auth.createPasswordReset(account, { ignoreCooldown: true });
    expect(made?.link).toContain('/redefinir-senha#token=');
  });

  it('o token não aparece no log', async () => {
    const lines: string[] = [];
    const logged = await createTestServer({ LOG_LEVEL: 'info' }, { logStream: { write: (l: string) => (lines.push(l), true) } as unknown as NodeJS.WritableStream });
    const mails: MailMessage[] = [];
    logged.ctx.mailer = { enabled: true, send: async (m) => void mails.push(m) };
    await register(logged, account);
    await logged.app.http.inject({ method: 'POST', url: '/api/auth/password/forgot', headers: { origin: ORIGIN }, payload: { email: account } });
    const token = tokenOf(mails[0]);
    await logged.app.http.inject({ method: 'POST', url: '/api/auth/password/reset', headers: { origin: ORIGIN }, payload: { token, password: NEW_PASSWORD } });
    const log = lines.join('');
    expect(log).toContain('senha.redefinida');
    expect(log).not.toContain(token);
    expect(log).not.toContain(account);
    await logged.close();
  });
});

describe('configuração do e-mail', () => {
  const base = { TOKEN_SECRET: 'a'.repeat(40), PASSWORD_PEPPER: 'b'.repeat(40), ALLOWED_ORIGINS: 'https://zehenia.example' };

  it('em produção, escrever e-mail no log é recusado (o link daria acesso à conta)', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', MAIL_PROVIDER: 'log' })).toThrow(/MAIL_PROVIDER/);
  });

  it('PUBLIC_URL precisa ser uma origem autorizada; resend precisa de chave e remetente', () => {
    expect(() => loadConfig({ ...base, PUBLIC_URL: 'https://outro.example' })).toThrow(/PUBLIC_URL/);
    expect(loadConfig({ ...base, PUBLIC_URL: 'https://zehenia.example/' }).publicUrl).toBe('https://zehenia.example');
    expect(() => loadConfig({ ...base, MAIL_PROVIDER: 'resend' })).toThrow(/MAIL_API_KEY/);
  });
});

describe('convites: quem não é o dono só entra assim', () => {
  let owner: { id: string; cookie: string };
  let tableId: string;
  const invite = async () => (await call(server, owner.cookie, 'POST', `/api/tables/${tableId}/invites`)).json();
  const redeemRaw = (payload: object, origin = ORIGIN) => inject({ method: 'POST', url: '/api/invites/redeem', headers: { origin }, payload });

  beforeEach(async () => {
    owner = await register(server, 'dono@exemplo.com', 'Dono');
    tableId = (await newTable(owner.cookie)).json().table.id;
  });

  it('o convite vem com o link, com o código depois do #, e o banco guarda só o hash', async () => {
    const { code, link } = await invite();
    expect(link).toBe(`${ORIGIN}/convite#codigo=${code}`);
    expect(code.length).toBeGreaterThanOrEqual(32);
    const rows = server.ctx.db.prepare('SELECT code_hash FROM table_invites').all() as { code_hash: string }[];
    expect(rows[0].code_hash).not.toContain(code);
  });

  it('entra só com o nome: sem e-mail, sem senha, com um id próprio e como jogador', async () => {
    const res = await redeemRaw({ code: (await invite()).code, name: '  Bia ' });
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toEqual({ id: expect.any(String), name: 'Bia', email: '', kind: 'guest', createdAt: expect.any(Number) });
    expect(res.json().table).toMatchObject({ id: tableId, role: 'player' });
    expect(res.body).not.toMatch(/password|hash|convidado:/);
    expect(String(res.headers['set-cookie'])).toMatch(/HttpOnly/);
    const me = await call(server, sessionCookie(res), 'GET', '/api/auth/me');
    expect(me.json().user.kind).toBe('guest');
  });

  it('o convite só vale uma vez: dois amigos não entram com o mesmo link', async () => {
    const { code } = await invite();
    expect((await redeemRaw({ code, name: 'Bia' })).statusCode).toBe(200);
    const second = await redeemRaw({ code, name: 'Intruso' });
    expect(second.statusCode).toBe(404);
    expect(server.ctx.tables.playerCount(tableId)).toBe(1);
  });

  it('código inventado, vencido ou sem nome não entra, e não cria conta', async () => {
    const before = (server.ctx.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
    expect((await redeemRaw({ code: 'a'.repeat(32), name: 'Bia' })).statusCode).toBe(404);
    const { code } = await invite();
    expect((await redeemRaw({ code })).statusCode).toBe(400);
    server.ctx.db.prepare('UPDATE table_invites SET expires_at = 1').run();
    expect((await redeemRaw({ code, name: 'Bia' })).statusCode).toBe(404);
    expect((server.ctx.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n).toBe(before);
  });

  it('outra origem é recusada (CSRF) e mesa cheia não aceita mais ninguém', async () => {
    const { code } = await invite();
    expect((await redeemRaw({ code, name: 'Bia' }, 'https://site-malicioso.example')).statusCode).toBe(403);
    server.ctx.db.prepare('UPDATE game_tables SET max_players = 0').run();
    expect((await redeemRaw({ code, name: 'Bia' })).statusCode).toBe(409);
  });

  it('convidado não entra com senha, não cria mesa nem mundo e não vê a mesa dos outros', async () => {
    const guest = await redeem(server, (await invite()).code, 'Bia');
    expect((await inject({ method: 'POST', url: '/api/auth/login', headers: { origin: ORIGIN }, payload: { email: `convidado:${guest.id}`, password: PASSWORD } })).statusCode).toBe(400);
    expect((await newTable(guest.cookie)).statusCode).toBe(403);
    expect((await call(server, guest.cookie, 'POST', '/api/worlds', { name: 'Meu' })).statusCode).toBe(403);
    expect((await call(server, guest.cookie, 'GET', '/api/worlds')).json().worlds).toEqual([]);
    const other = await register(server, 'outro@exemplo.com');
    const otherTable = (await newTable(other.cookie)).json().table.id;
    expect((await call(server, guest.cookie, 'GET', `/api/tables/${otherTable}`)).statusCode).toBe(404);
    expect((await call(server, guest.cookie, 'POST', `/api/tables/${tableId}/invites`)).statusCode).toBe(403);
  });

  it('a sessão do convidado não cai por inatividade, porque ele não tem senha para voltar', async () => {
    const guest = await redeem(server, (await invite()).code, 'Bia');
    server.ctx.db.prepare('UPDATE sessions SET last_seen_at = 1').run();
    server.ctx.auth.sweep();
    expect((await call(server, guest.cookie, 'GET', '/api/auth/me')).statusCode).toBe(200);
    expect((await call(server, owner.cookie, 'GET', '/api/auth/me')).statusCode).toBe(401);
  });

  it('link de retorno: o convidado volta à MESMA conta, uma vez só; ninguém mais o usa', async () => {
    const guest = await redeem(server, (await invite()).code, 'Bia');
    const url = `/api/tables/${tableId}/members/${guest.id}/access-link`;
    expect((await call(server, guest.cookie, 'POST', url)).statusCode).toBe(403);
    const { code } = (await call(server, owner.cookie, 'POST', url)).json();
    const logged = await register(server, 'outro@exemplo.com');
    expect((await call(server, logged.cookie, 'POST', '/api/invites/accept', { code })).statusCode).toBe(404);
    const back = await redeemRaw({ code });
    expect(back.statusCode).toBe(200);
    expect(back.json().user.id).toBe(guest.id);
    expect((await redeemRaw({ code })).statusCode).toBe(404);
    expect((await call(server, owner.cookie, 'POST', `/api/tables/${tableId}/members/${owner.id}/access-link`)).statusCode).toBe(404);
  });

  it('tirar o convidado da mesa encerra o acesso dele', async () => {
    const guest = await redeem(server, (await invite()).code, 'Bia');
    expect((await call(server, owner.cookie, 'DELETE', `/api/tables/${tableId}/members/${guest.id}`)).statusCode).toBe(204);
    expect((await call(server, guest.cookie, 'GET', '/api/auth/me')).statusCode).toBe(401);
  });

  it('o convidado pode excluir a própria conta sem senha; o dono continua precisando dela', async () => {
    const guest = await redeem(server, (await invite()).code, 'Bia');
    expect((await call(server, owner.cookie, 'DELETE', '/api/auth/me', {})).statusCode).toBe(401);
    expect((await call(server, guest.cookie, 'DELETE', '/api/auth/me', {})).statusCode).toBe(204);
    expect(server.ctx.users.findById(guest.id)).toBeNull();
  });

  it('convidado tem limites menores de envio: o disco é do dono', async () => {
    const small = await createTestServer({ GUEST_QUOTA_MB: '1', GUEST_MAX_UPLOAD_MB: '1' });
    const dono = await register(small, 'dono@exemplo.com');
    const mesa = (await call(small, dono.cookie, 'POST', '/api/tables', { name: 'M', system: '', description: '', maxPlayers: 4, accent: '#4f86f7' })).json().table.id;
    const guest = await redeem(small, (await call(small, dono.cookie, 'POST', `/api/tables/${mesa}/invites`)).json().code);
    const big = multipart(Buffer.concat([PNG_1X1, Buffer.alloc(2 * 1024 * 1024)]));
    const send = (cookie: string) => small.app.http.inject({ method: 'POST', url: `/api/files?tableId=${mesa}`, headers: { cookie, origin: ORIGIN, 'content-type': big.contentType }, payload: big.body });
    expect((await send(guest.cookie)).statusCode).toBe(413);
    expect((await send(dono.cookie)).statusCode).toBe(201);
    await small.close();
  });
});
