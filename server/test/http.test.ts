import type { InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ORIGIN, PASSWORD, PNG_1X1, call, createTestServer, multipart, register, sessionCookie, type TestServer } from './helpers';

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
  it('cadastro cria sessão com cookie HttpOnly, Secure e SameSite=Strict, sem token no corpo', async () => {
    const res = await inject({ method: 'POST', url: '/api/auth/register', headers: { origin: ORIGIN }, payload: { name: 'Ana', email: 'Ana@Exemplo.com ', password: PASSWORD } });
    expect(res.statusCode).toBe(201);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/^__Host-zh_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(res.json().user).toEqual({ id: expect.any(String), name: 'Ana', email: 'ana@exemplo.com', createdAt: expect.any(Number) });
    expect(res.body).not.toContain(sessionCookie(res).split('=')[1]);
    expect(res.body).not.toMatch(/password|hash/i);
  });

  it('cadastro cria o primeiro mundo da conta', async () => {
    const { cookie } = await register(server, 'a@exemplo.com');
    const res = await call(server, cookie, 'GET', '/api/worlds');
    expect(res.json().worlds).toHaveLength(1);
  });

  it('recusa senha fraca e e-mail repetido', async () => {
    const weak = await inject({ method: 'POST', url: '/api/auth/register', headers: { origin: ORIGIN }, payload: { name: 'A', email: 'a@exemplo.com', password: '12345678' } });
    expect(weak.statusCode).toBe(400);
    await register(server, 'a@exemplo.com');
    const dup = await inject({ method: 'POST', url: '/api/auth/register', headers: { origin: ORIGIN }, payload: { name: 'B', email: 'A@exemplo.com', password: PASSWORD } });
    expect(dup.statusCode).toBe(409);
  });

  it('login: mesma resposta para e-mail inexistente e senha errada', async () => {
    await register(server, 'a@exemplo.com');
    const wrong = await inject({ method: 'POST', url: '/api/auth/login', headers: { origin: ORIGIN }, payload: { email: 'a@exemplo.com', password: 'errada-123' } });
    const missing = await inject({ method: 'POST', url: '/api/auth/login', headers: { origin: ORIGIN }, payload: { email: 'b@exemplo.com', password: 'errada-123' } });
    expect(wrong.statusCode).toBe(401);
    expect(missing.statusCode).toBe(401);
    expect(wrong.json()).toEqual(missing.json());
  });

  it('bloqueia o e-mail depois de 5 senhas erradas', async () => {
    await register(server, 'a@exemplo.com');
    const attempt = (password: string) => inject({ method: 'POST', url: '/api/auth/login', headers: { origin: ORIGIN }, payload: { email: 'a@exemplo.com', password } });
    for (let i = 0; i < 5; i++) expect((await attempt('errada-123')).statusCode).toBe(401);
    expect((await attempt(PASSWORD)).statusCode).toBe(429);
  });

  it('logout encerra a sessão no servidor (o cookie antigo deixa de valer)', async () => {
    const { cookie } = await register(server, 'a@exemplo.com');
    expect((await call(server, cookie, 'GET', '/api/auth/me')).statusCode).toBe(200);
    expect((await call(server, cookie, 'POST', '/api/auth/logout')).statusCode).toBe(204);
    expect((await call(server, cookie, 'GET', '/api/auth/me')).statusCode).toBe(401);
  });

  it('trocar a senha encerra as outras sessões', async () => {
    const { cookie } = await register(server, 'a@exemplo.com');
    const login = await inject({ method: 'POST', url: '/api/auth/login', headers: { origin: ORIGIN }, payload: { email: 'a@exemplo.com', password: PASSWORD } });
    const other = sessionCookie(login);
    const res = await call(server, cookie, 'POST', '/api/auth/password', { current: PASSWORD, next: 'outra senha bem longa' });
    expect(res.statusCode).toBe(204);
    expect((await call(server, other, 'GET', '/api/auth/me')).statusCode).toBe(401);
    expect((await call(server, cookie, 'GET', '/api/auth/me')).statusCode).toBe(200);
  });

  it('cookie forjado ou ausente = 401', async () => {
    expect((await call(server, '__Host-zh_session=inventado', 'GET', '/api/auth/me')).statusCode).toBe(401);
    expect((await inject({ method: 'GET', url: '/api/tables' })).statusCode).toBe(401);
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
    const res = await inject({ method: 'POST', url: '/api/auth/register', headers: { origin: ORIGIN }, payload: { name: '<script>x</script>', email: 'não-é-email', password: PASSWORD } });
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

    expect((await call(server, p1.cookie, 'POST', '/api/invites/accept', { code })).json().table.role).toBe('player');
    expect((await call(server, p2.cookie, 'POST', '/api/invites/accept', { code })).statusCode).toBe(200);
    // Convite esgotado (usos = limite de jogadores) é "inválido"; com convite novo, a mesa cheia recusa
    expect((await call(server, p3.cookie, 'POST', '/api/invites/accept', { code })).statusCode).toBe(404);
    const fresh = (await call(server, gm.cookie, 'POST', `/api/tables/${table.id}/invites`)).json().code;
    expect((await call(server, p3.cookie, 'POST', '/api/invites/accept', { code: fresh })).statusCode).toBe(409);
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

  it('recusa SVG com script mesmo com nome .png e Content-Type de imagem', async () => {
    const { cookie } = await register(server, 'gm@exemplo.com');
    const { table } = (await newTable(cookie)).json();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
    expect((await upload(cookie, `tableId=${table.id}`, svg, 'mapa.png', 'image/png')).statusCode).toBe(415);
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
