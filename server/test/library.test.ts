import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { freeName, isSafeName, parseLibraryPath, safeFileName } from '../src/security/library-path';
import { ORIGIN, PNG_1X1, call, createTestServer, multipart, redeem, register, type TestServer } from './helpers';

/**
 * Biblioteca de arquivos: só o dono entra, e nenhum caminho sai da pasta. A pasta "de fora" e o
 * arquivo secreto existem de verdade em cada teste: se uma defesa falhar, o teste lê o segredo.
 */

let server: TestServer;
let owner: { id: string; cookie: string };
let base: string;
let root: string;
const SECRET = 'SEGREDO-FORA-DA-BIBLIOTECA';
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64)]);

beforeEach(async () => {
  base = mkdtempSync(join(tmpdir(), 'zehenia-lib-'));
  root = join(base, 'biblioteca');
  writeFileSync(join(base, 'segredo.png'), SECRET);
  writeFileSync(join(base, 'segredo.txt'), SECRET);
  server = await createTestServer({ LIBRARY_DIR: root });
  owner = await register(server, 'dono@exemplo.com', 'Dono');
});
afterEach(async () => {
  await server.close();
  rmSync(base, { recursive: true, force: true });
});

const list = async () => (await call(server, owner.cookie, 'GET', '/api/library')).json();
const read = (path: string, cookie = owner.cookie) => server.app.http.inject({ method: 'GET', url: '/api/library/file', query: { path }, headers: { cookie, origin: ORIGIN } });
const send = (folder: string, content: Buffer, name: string, type: string, cookie = owner.cookie) => {
  const { body, contentType } = multipart(content, name, type);
  return server.app.http.inject({ method: 'POST', url: '/api/library/files', query: { folder }, headers: { cookie, origin: ORIGIN, 'content-type': contentType }, payload: body });
};

describe('caminhos: nada sai da pasta', () => {
  const attempts = [
    '../segredo.png',
    'imagens/../../segredo.png',
    'imagens/../sons/x.mp3',
    'imagens/./x.png',
    '..',
    '.',
    '/etc/passwd',
    'C:/Windows/win.ini',
    'C:\\Windows\\win.ini',
    '..\\segredo.png',
    'imagens\\..\\..\\segredo.png',
    '\\\\servidor\\pasta\\x.png',
    'imagens//x.png',
    'imagens/x.png/',
    'imagens/x.png:fluxo',
    'imagens/x.png.',
    'imagens/x.png ',
    'imagens/CON',
    'imagens/nul.png',
    'imagens/\u0000x.png',
    '.enviando/x',
    'imagens/.oculto',
    'outra/x.png',
    '',
  ];

  it.each(attempts)('recusa %j', (attempt) => {
    expect(() => parseLibraryPath(root, attempt)).toThrow();
  });

  it('aceita caminhos comuns, com acentos e espaços', () => {
    const parsed = parseLibraryPath(root, 'imagens/Mapas da Ponte/Caverna 2.png');
    expect(parsed.section).toBe('imagens');
    expect(parsed.absolute).toBe(join(root, 'imagens', 'Mapas da Ponte', 'Caverna 2.png'));
    expect(parseLibraryPath(root, 'sons/Música/ação.mp3').relative).toBe('sons/Música/ação.mp3');
  });

  it('o nome de um envio nunca vira um caminho', () => {
    expect(safeFileName('../../segredo.png')).toBe('segredo.png');
    expect(safeFileName('C:\\Users\\Ana\\foto.png')).toBe('foto.png');
    expect(safeFileName('a:b*c?.png')).toBe('a-b-c-.png');
    expect(safeFileName('...oculto.png')).toBe('oculto.png');
    expect(safeFileName('CON.png')).toBe('_CON.png');
    expect(safeFileName('x'.repeat(500) + '.png').length).toBeLessThanOrEqual(120);
    expect(isSafeName(safeFileName('../..'))).toBe(true);
  });

  it('nome repetido ganha um número, sem sobrescrever', async () => {
    const taken = new Set(['a.png', 'a (2).png']);
    expect(await freeName('a.png', async (n) => taken.has(n))).toBe('a (3).png');
    expect(await freeName('b.png', async (n) => taken.has(n))).toBe('b.png');
  });
});

describe('pelas rotas', () => {
  it('só o dono: convidado e quem não entrou não acessam nada', async () => {
    writeFileSync(join(root, 'imagens', 'mapa.png'), PNG_1X1);
    const table = (await call(server, owner.cookie, 'POST', '/api/tables', { name: 'M', system: '', description: '', maxPlayers: 4, accent: '#4f86f7' })).json().table;
    const { code } = (await call(server, owner.cookie, 'POST', `/api/tables/${table.id}/invites`)).json();
    const guest = await redeem(server, code);
    expect((await call(server, guest.cookie, 'GET', '/api/library')).statusCode).toBe(403);
    expect((await read('imagens/mapa.png', guest.cookie)).statusCode).toBe(403);
    expect((await send('imagens', PNG_1X1, 'x.png', 'image/png', guest.cookie)).statusCode).toBe(403);
    expect((await call(server, guest.cookie, 'POST', '/api/library/delete', { path: 'imagens/mapa.png' })).statusCode).toBe(403);
    expect((await server.app.http.inject({ method: 'GET', url: '/api/library' })).statusCode).toBe(401);
    expect(existsSync(join(root, 'imagens', 'mapa.png'))).toBe(true);
  });

  it('nenhuma tentativa de sair da pasta lê, escreve ou apaga o que está fora', async () => {
    for (const path of ['../segredo.png', 'imagens/../../segredo.png', '..\\segredo.png', 'C:/Windows/win.ini']) {
      const res = await read(path);
      expect(res.statusCode).toBe(400);
      expect(res.body).not.toContain(SECRET);
      expect((await call(server, owner.cookie, 'POST', '/api/library/delete', { path })).statusCode).toBe(400);
      expect((await call(server, owner.cookie, 'POST', '/api/library/move', { from: path, to: 'imagens/roubado.png' })).statusCode).toBe(400);
      expect((await call(server, owner.cookie, 'POST', '/api/library/move', { from: 'imagens', to: path })).statusCode).toBe(400);
      expect((await send(path, PNG_1X1, 'x.png', 'image/png')).statusCode).toBe(400);
      expect((await call(server, owner.cookie, 'POST', '/api/library/folders', { path })).statusCode).toBe(400);
    }
    expect(existsSync(join(base, 'segredo.png'))).toBe(true);
    expect(readdirSync(base).sort()).toEqual(['biblioteca', 'segredo.png', 'segredo.txt']);
  });

  it('o nome do envio não tira o arquivo da pasta', async () => {
    const res = await send('imagens', PNG_1X1, '../../fora.png', 'image/png');
    expect(res.statusCode).toBe(201);
    expect(res.json().entry.path).toBe('imagens/fora.png');
    expect(existsSync(join(base, 'fora.png'))).toBe(false);
    expect(existsSync(join(root, 'imagens', 'fora.png'))).toBe(true);
  });

  it('junção do Windows (atalho de pasta, não exige administrador) não leva para fora', async () => {
    const dirLink = join(root, 'imagens', 'pasta-atalho');
    symlinkSync(base, dirLink, 'junction');
    const { entries, ignored } = await list();
    expect(entries.map((e: { path: string }) => e.path)).not.toContain('imagens/pasta-atalho');
    expect(ignored).toBe(1);
    const through = await read('imagens/pasta-atalho/segredo.png');
    expect(through.statusCode).toBe(400);
    expect(through.body).not.toContain(SECRET);
    expect((await send('imagens/pasta-atalho', PNG_1X1, 'dentro.png', 'image/png')).statusCode).toBe(400);
    expect(existsSync(join(base, 'dentro.png'))).toBe(false);
    expect((await call(server, owner.cookie, 'POST', '/api/library/folders', { path: 'imagens/pasta-atalho/nova' })).statusCode).toBe(400);
    expect(existsSync(join(base, 'nova'))).toBe(false);
    expect((await call(server, owner.cookie, 'POST', '/api/library/move', { from: 'imagens/pasta-atalho/segredo.png', to: 'imagens/roubado.png' })).statusCode).toBe(400);
    expect((await call(server, owner.cookie, 'POST', '/api/library/delete', { path: 'imagens/pasta-atalho/segredo.txt' })).statusCode).toBe(400);
    expect((await call(server, owner.cookie, 'POST', '/api/library/delete', { path: 'imagens/pasta-atalho' })).statusCode).toBe(400);
    expect(existsSync(join(base, 'segredo.txt'))).toBe(true);
  });

  it('link simbólico de arquivo não é listado nem lido', async (ctx) => {
    const link = join(root, 'imagens', 'atalho.png');
    try {
      symlinkSync(join(base, 'segredo.png'), link);
    } catch {
      // No Windows, criar link de arquivo exige modo de desenvolvedor ou administrador
      return ctx.skip();
    }
    expect((await list()).entries.map((e: { path: string }) => e.path)).not.toContain('imagens/atalho.png');
    const res = await read('imagens/atalho.png');
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain(SECRET);
  });

  it('apagar uma pasta que contém um atalho não apaga o destino dele', async () => {
    mkdirSync(join(root, 'imagens', 'Grupo'));
    symlinkSync(base, join(root, 'imagens', 'Grupo', 'para-fora'), 'junction');
    expect((await call(server, owner.cookie, 'POST', '/api/library/delete', { path: 'imagens/Grupo' })).statusCode).toBe(204);
    expect(existsSync(join(root, 'imagens', 'Grupo'))).toBe(false);
    expect(existsSync(join(base, 'segredo.txt'))).toBe(true);
    expect(existsSync(join(base, 'segredo.png'))).toBe(true);
  });

  it('tipos: cada pasta aceita o dela, pelos bytes; SVG e página disfarçada ficam de fora', async () => {
    expect((await send('imagens', PNG_1X1, 'mapa.png', 'image/png')).statusCode).toBe(201);
    expect((await send('sons', MP3, 'trilha.mp3', 'audio/mpeg')).statusCode).toBe(201);
    expect((await send('sons', PNG_1X1, 'mapa.png', 'image/png')).statusCode).toBe(415);
    expect((await send('imagens', MP3, 'trilha.mp3', 'audio/mpeg')).statusCode).toBe(415);
    expect((await send('imagens', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>'), 'x.svg', 'image/svg+xml')).statusCode).toBe(415);
    expect((await send('imagens', Buffer.from('<html><script>alert(1)</script></html>'.padEnd(64)), 'x.png', 'image/png')).statusCode).toBe(415);
    expect((await send('imagens', MP3, 'x.png', 'image/png')).statusCode).toBe(415);
  });

  it('arquivo colocado à mão aparece na lista; o disfarçado é listado mas não é entregue', async () => {
    mkdirSync(join(root, 'imagens', 'Mapas'));
    writeFileSync(join(root, 'imagens', 'Mapas', 'ponte.png'), PNG_1X1);
    writeFileSync(join(root, 'imagens', 'falso.png'), '<html><script>alert(1)</script></html>'.padEnd(64));
    writeFileSync(join(root, 'imagens', 'leia-me.txt'), 'texto');
    writeFileSync(join(root, 'imagens', 'programa.exe'), 'MZ');
    const { entries, ignored } = await list();
    const paths = entries.map((e: { path: string }) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['imagens/Mapas', 'imagens/Mapas/ponte.png', 'imagens/falso.png']));
    expect(paths).not.toContain('imagens/leia-me.txt');
    expect(ignored).toBe(2);
    const good = await read('imagens/Mapas/ponte.png');
    expect(good.statusCode).toBe(200);
    expect(good.headers['content-type']).toBe('image/png');
    expect(good.headers['x-content-type-options']).toBe('nosniff');
    expect(good.headers['content-security-policy']).toContain('sandbox');
    expect((await read('imagens/falso.png')).statusCode).toBe(415);
    expect((await read('imagens/leia-me.txt')).statusCode).toBe(404);
  });

  it('pastas: criar, mover e apagar; as principais são fixas e nada é sobrescrito', async () => {
    const folder = (path: string) => call(server, owner.cookie, 'POST', '/api/library/folders', { path });
    const move = (from: string, to: string) => call(server, owner.cookie, 'POST', '/api/library/move', { from, to });
    const remove = (path: string) => call(server, owner.cookie, 'POST', '/api/library/delete', { path });
    expect((await folder('imagens/Mapas')).statusCode).toBe(201);
    expect((await folder('imagens/Mapas')).statusCode).toBe(409);
    expect((await folder('sons/Música/Combate')).statusCode).toBe(201);
    await send('imagens/Mapas', PNG_1X1, 'a.png', 'image/png');
    await send('imagens', PNG_1X1, 'a.png', 'image/png');

    expect((await move('imagens/a.png', 'imagens/Mapas/a.png')).statusCode).toBe(409);
    expect((await move('imagens/a.png', 'imagens/Mapas/b.png')).statusCode).toBe(204);
    expect((await move('imagens/Mapas/b.png', 'sons/b.png')).statusCode).toBe(400);
    expect((await move('imagens/Mapas', 'imagens/Mapas/Dentro')).statusCode).toBe(400);
    expect((await move('imagens/Mapas/b.png', 'imagens/Mapas/b.exe')).statusCode).toBe(400);
    expect((await move('imagens', 'imagens/Outra')).statusCode).toBe(400);
    expect((await remove('imagens')).statusCode).toBe(400);
    expect((await remove('sons')).statusCode).toBe(400);
    expect((await remove('imagens/Mapas')).statusCode).toBe(204);
    expect(existsSync(join(root, 'imagens', 'Mapas'))).toBe(false);
    expect(existsSync(join(root, 'imagens'))).toBe(true);
  });

  it('envio repetido ganha outro nome e não sobrescreve', async () => {
    const first = await send('imagens', PNG_1X1, 'mapa.png', 'image/png');
    const second = await send('imagens', PNG_1X1, 'mapa.png', 'image/png');
    expect(first.json().entry.name).toBe('mapa.png');
    expect(second.json().entry.name).toBe('mapa (2).png');
  });

  it('envio acima do limite é recusado e não deixa sobra', async () => {
    const small = await createTestServer({ LIBRARY_DIR: join(base, 'pequena'), LIBRARY_MAX_UPLOAD_MB: '1' });
    const dono = await register(small, 'dono@exemplo.com');
    const { body, contentType } = multipart(Buffer.concat([PNG_1X1, Buffer.alloc(2 * 1024 * 1024)]), 'grande.png', 'image/png');
    const res = await small.app.http.inject({ method: 'POST', url: '/api/library/files', query: { folder: 'imagens' }, headers: { cookie: dono.cookie, origin: ORIGIN, 'content-type': contentType }, payload: body });
    expect(res.statusCode).toBe(413);
    expect(readdirSync(join(base, 'pequena', 'imagens'))).toEqual([]);
    expect(readdirSync(join(base, 'pequena', '.enviando'))).toEqual([]);
    await small.close();
  });

  it('a lista mostra a pasta real, e a pasta de envios nunca aparece', async () => {
    await send('imagens', PNG_1X1, 'mapa.png', 'image/png');
    const data = await list();
    expect(data.root).toBe(root);
    expect(data.entries.map((e: { path: string }) => e.path)).toEqual(['imagens/mapa.png']);
    expect(JSON.stringify(data.entries)).not.toContain('.enviando');
  });

  it('outra origem é recusada ao alterar (CSRF)', async () => {
    const { body, contentType } = multipart(PNG_1X1, 'x.png', 'image/png');
    const res = await server.app.http.inject({ method: 'POST', url: '/api/library/files', query: { folder: 'imagens' }, headers: { cookie: owner.cookie, origin: 'https://site-malicioso.example', 'content-type': contentType }, payload: body });
    expect(res.statusCode).toBe(403);
  });
});
