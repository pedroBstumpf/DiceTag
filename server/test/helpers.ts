import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import WebSocket from 'ws';
import { buildApp, type App, type BuildOptions } from '../src/app';
import { loadConfig, type Config } from '../src/config/env';
import { createContext, type AppContext } from '../src/context';
import { openDatabase } from '../src/db/database';

/**
 * Servidor de teste: banco em memória, pasta de arquivos temporária, segredos aleatórios,
 * scrypt mais barato (custo 2^14) e sem limite de taxa (os testes de limite ligam à parte).
 */
export const ORIGIN = 'http://localhost:4200';
/** Senha das contas de teste: aleatória a cada execução (nenhuma senha escrita no código). */
export const PASSWORD = randomBytes(12).toString('base64url');

export interface TestServer {
  app: App;
  ctx: AppContext;
  config: Config;
  close: () => Promise<void>;
}

export async function createTestServer(overrides: Record<string, string> = {}, options: BuildOptions = {}): Promise<TestServer> {
  const filesDir = mkdtempSync(join(tmpdir(), 'zehenia-test-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_PATH: ':memory:',
    FILES_DIR: filesDir,
    LIBRARY_DIR: `${filesDir}-biblioteca`,
    ALLOWED_ORIGINS: ORIGIN,
    TOKEN_SECRET: randomBytes(32).toString('hex'),
    PASSWORD_PEPPER: randomBytes(32).toString('hex'),
    PASSWORD_COST: '14',
    RATE_LIMIT: 'false',
    ...overrides,
  });
  const db = openDatabase(config.DATABASE_PATH);
  // Em produção o banco só admite um dono. Aqui, os testes de isolamento precisam de vários com mesas
  // próprias (um tentando acessar o do outro); o índice tem teste próprio em database.test.ts
  db.exec('DROP INDEX users_one_owner');
  const ctx = createContext(config, db);
  const app = await buildApp(ctx, options);
  return {
    app,
    ctx,
    config,
    close: async () => {
      await app.http.close();
      db.close();
      rmSync(filesDir, { recursive: true, force: true });
      rmSync(`${filesDir}-biblioteca`, { recursive: true, force: true });
    },
  };
}

/** Cookie de sessão de uma resposta (como o navegador guardaria). */
export function sessionCookie(res: LightMyRequestResponse): string {
  const header = res.headers['set-cookie'];
  const cookies = Array.isArray(header) ? header : header ? [header] : [];
  const cookie = cookies.find((c) => c.includes('zh_session='));
  if (!cookie) throw new Error('sem cookie de sessão');
  return cookie.split(';')[0];
}

/**
 * Cria uma conta com senha, direto pelo serviço (não há cadastro público), e entra com ela.
 * Vale como dono: os testes de isolamento precisam de várias contas com mesas próprias.
 */
export async function register(server: TestServer, email: string, name = 'Pessoa'): Promise<{ id: string; cookie: string }> {
  const { user } = await server.ctx.auth.createAccount({ name, email, password: PASSWORD }, 'owner');
  const res = await server.app.http.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: ORIGIN }, payload: { email, password: PASSWORD } });
  if (res.statusCode !== 200) throw new Error(`login falhou: ${res.statusCode} ${res.body}`);
  return { id: user.id, cookie: sessionCookie(res) };
}

/** Entra por um convite, como um amigo do dono: devolve a conta criada e o cookie. */
export async function redeem(server: TestServer, code: string, name = 'Convidado'): Promise<{ id: string; cookie: string }> {
  const res = await server.app.http.inject({ method: 'POST', url: '/api/invites/redeem', headers: { origin: ORIGIN }, payload: { code, name } });
  if (res.statusCode !== 200) throw new Error(`convite falhou: ${res.statusCode} ${res.body}`);
  return { id: res.json().user.id, cookie: sessionCookie(res) };
}

/** Requisição autenticada com origem permitida. */
export function call(server: TestServer, cookie: string, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) {
  return server.app.http.inject({
    method,
    url,
    headers: { cookie, origin: ORIGIN },
    ...(payload !== undefined && { payload: payload as object }),
  });
}

// --- WebSocket -----------------------------------------------------------------

export interface TestSocket {
  ws: WebSocket;
  /** Próxima mensagem do tipo `t` (espera até 2 s). */
  next: (t: string) => Promise<any>;
  /** Mensagens recebidas e ainda não consumidas. */
  inbox: any[];
  closed: Promise<{ code: number; reason: string }>;
}

/** Abre o socket da mesa. Recusa no upgrade = rejeita com "HTTP <status>". */
export function openSocket(port: number, tableId: string, cookie: string, origin = ORIGIN): Promise<TestSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/tables/${tableId}`, { headers: { cookie, origin } });
    const inbox: any[] = [];
    const waiters: { t: string; resolve: (m: any) => void }[] = [];
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      const i = waiters.findIndex((w) => w.t === msg.t);
      if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
      else inbox.push(msg);
    });
    const closed = new Promise<{ code: number; reason: string }>((res) => ws.on('close', (code, reason) => res({ code, reason: reason.toString() })));
    const next = (t: string) =>
      new Promise<any>((res, rej) => {
        const i = inbox.findIndex((m) => m.t === t);
        if (i >= 0) return res(inbox.splice(i, 1)[0]);
        const timer = setTimeout(() => rej(new Error(`tempo esgotado esperando "${t}"`)), 2000);
        waiters.push({ t, resolve: (m) => (clearTimeout(timer), res(m)) });
      });
    ws.on('open', () => resolve({ ws, next, inbox, closed }));
    ws.on('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.on('error', reject);
  });
}

/** PNG mínimo válido (1×1). */
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/** Corpo multipart com um arquivo. */
export function multipart(content: Buffer, filename = 'arquivo.png', type = 'image/png'): { body: Buffer; contentType: string } {
  const boundary = `----zehenia${randomBytes(8).toString('hex')}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}
