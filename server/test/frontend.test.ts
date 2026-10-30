import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestServer, type TestServer } from './helpers';

/**
 * App Angular entregue pelo servidor (FRONTEND_DIR): arquivos do build, rotas do app caindo no
 * index.html, CSP sem scripts inline e nada fora da pasta do build.
 */
describe('front-end servido pelo servidor', () => {
  let server: TestServer;
  let dir: string;
  let outside: string;

  beforeAll(async () => {
    outside = mkdtempSync(join(tmpdir(), 'zehenia-front-'));
    dir = join(outside, 'browser');
    mkdirSync(join(dir, 'images'), { recursive: true });
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>app</title>');
    writeFileSync(join(dir, 'main-ABCD1234.js'), 'console.log(1)');
    writeFileSync(join(dir, 'favicon.png'), 'png');
    writeFileSync(join(dir, 'images', 'emblem.png'), 'png');
    writeFileSync(join(dir, 'notes.md'), 'tipo não servido');
    // Arquivo FORA da pasta do build: nunca pode ser entregue
    writeFileSync(join(outside, 'segredo.txt'), 'não deveria sair');
    server = await createTestServer({ FRONTEND_DIR: dir });
  });

  afterAll(async () => {
    await server.close();
    rmSync(outside, { recursive: true, force: true });
  });

  const get = (url: string) => server.app.http.inject({ method: 'GET', url });

  it('entrega o index.html na raiz, com CSP que bloqueia scripts inline', async () => {
    const res = await get('/');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('<title>app</title>');
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('rotas do app (sem extensão) caem no index.html', async () => {
    for (const url of ['/mesas', '/mesa-online/abc123', '/worldbuild?novo=item']) {
      const res = await get(url);
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('<title>app</title>');
    }
  });

  it('arquivos do build: com hash ficam em cache para sempre; os outros são conferidos', async () => {
    const js = await get('/main-ABCD1234.js');
    expect(js.statusCode).toBe(200);
    expect(js.headers['content-type']).toContain('text/javascript');
    expect(js.headers['cache-control']).toContain('immutable');
    const img = await get('/images/emblem.png');
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['cache-control']).toBe('no-cache');
  });

  it('arquivo inexistente, de tipo não servido ou fora da pasta: 404', async () => {
    for (const url of ['/nao-existe.js', '/notes.md', '/../segredo.txt', '/%2e%2e/segredo.txt', '/..%2fsegredo.txt', '/images/../../segredo.txt']) {
      const res = await get(url);
      expect(res.statusCode, url).toBe(404);
      expect(res.body).not.toContain('não deveria sair');
    }
  });

  it('caminhos do servidor não caem no app: API desconhecida continua 404 JSON e a API exige sessão', async () => {
    const unknown = await get('/api/nao-existe');
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({ error: 'Não encontrado.' });
    expect((await get('/api')).statusCode).toBe(404);
    expect((await get('/api/tables')).statusCode).toBe(401);
    expect((await get('/api/health')).json()).toEqual({ status: 'ok' });
  });

  it('sem FRONTEND_DIR (ou pasta sem index.html), o servidor entrega só a API', async () => {
    for (const overrides of [{}, { FRONTEND_DIR: join(outside, 'vazia') }]) {
      const apiOnly = await createTestServer(overrides);
      try {
        expect((await apiOnly.app.http.inject({ method: 'GET', url: '/' })).statusCode).toBe(404);
        expect((await apiOnly.app.http.inject({ method: 'GET', url: '/mesas' })).statusCode).toBe(404);
      } finally {
        await apiOnly.close();
      }
    }
  });
});
