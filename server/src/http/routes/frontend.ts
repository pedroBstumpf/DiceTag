import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Config } from '../../config/env';
import { PUBLIC } from '../plugins/auth';

/** Tipos dos arquivos do build do Angular que o servidor entrega (outros não são servidos). */
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** Arquivo com hash no nome (`main-WG2ORTFG.js`): o conteúdo nunca muda, pode ficar em cache para sempre. */
const HASHED = /-[A-Z0-9]{8}\.(js|css)$/;

/** Prefixos do servidor: nunca caem no app (rota desconhecida responde o 404 JSON da API). */
const SERVER_PREFIXES = ['/api/', '/ws/', '/dev/'];

interface StaticFile {
  path: string;
  type: string;
}

/**
 * CSP do app Angular (BACKEND_SECURITY.md §9): scripts só deste servidor (nenhum inline), conexões
 * só com ele (API e WebSocket), fontes do Google Fonts, imagens e sons de arquivos locais (`blob:`).
 * `style-src 'unsafe-inline'`: o Angular, o Material e o editor de texto criam `<style>` em tempo de
 * execução. Risco aceito: CSS injetado não executa código (os scripts continuam travados).
 */
export function frontendCsp(config: Config): string {
  // WebSocket da mesma origem: 'self' já cobre nos navegadores atuais; os ws(s):// explícitos cobrem os antigos
  const sockets = [...config.allowedOrigins].map((o) => o.replace(/^http/, 'ws'));
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    `connect-src 'self' ${sockets.join(' ')}`,
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "manifest-src 'self'",
    // <base href="/"> do index.html
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; ');
}

/**
 * Lista os arquivos do build (feito uma vez, ao subir): URL → arquivo. Uma requisição só acha o que
 * está nesta lista, então nada vindo da URL vira caminho no disco (sem `../`, sem arquivos fora da pasta).
 */
export function listFrontendFiles(dir: string): Map<string, StaticFile> {
  const root = resolve(dir);
  const files = new Map<string, StaticFile>();
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile() && TYPES[extname(name).toLowerCase()]) {
        files.set(`/${relative(root, path).split(sep).join('/')}`, { path, type: TYPES[extname(name).toLowerCase()] });
      }
    }
  };
  walk(root);
  return files;
}

/**
 * Entrega o app Angular já compilado (`npm run build` na raiz) pelo próprio servidor: um processo
 * só, sem o `ng serve` (mais leve para testar e o jeito de publicar). Ligado por `FRONTEND_DIR`.
 *
 * - Arquivo da lista → ele mesmo (com cache longo se tiver hash no nome).
 * - Caminho sem extensão (rota do app, ex.: /mesa-online/abc) → `index.html` (o roteador do Angular resolve).
 * - Prefixos do servidor (/api, /ws, /dev) e arquivos inexistentes → 404.
 * Rotas públicas (o app em si não tem dados; os dados vêm da API, que exige sessão).
 */
export async function frontendRoutes(app: FastifyInstance, config: Config): Promise<void> {
  const dir = config.FRONTEND_DIR;
  if (!dir) return;
  if (!existsSync(join(dir, 'index.html'))) {
    app.log.warn({ dir }, 'Front-end não encontrado (rode `npm run build` na raiz do projeto): servindo só a API.');
    return;
  }
  const files = listFrontendFiles(dir);
  const index = files.get('/index.html')!;

  const send = async (reply: FastifyReply, file: StaticFile, cache: string) =>
    reply.header('Content-Type', file.type).header('Content-Security-Policy', frontendCsp(config)).header('Cache-Control', cache).send(await readFile(file.path));

  app.get('/*', { config: PUBLIC }, async (req, reply) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (SERVER_PREFIXES.some((p) => path.startsWith(p) || `${path}/` === p)) return reply.code(404).send({ error: 'Não encontrado.' });
    const file = files.get(path);
    if (file && file !== index) return send(reply, file, HASHED.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache');
    // Rota do app (sem extensão no último trecho): o index.html, sempre conferido de novo (pega builds novos)
    const last = path.slice(path.lastIndexOf('/') + 1);
    if (file === index || !last.includes('.')) return send(reply, index, 'no-cache');
    return reply.code(404).send({ error: 'Não encontrado.' });
  });
  app.log.info({ dir, files: files.size }, 'Front-end servido pelo servidor.');
}
