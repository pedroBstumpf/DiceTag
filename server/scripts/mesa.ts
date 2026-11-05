import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { build } from 'esbuild';
import { loadConfig } from '../src/config/env';
import { createContext } from '../src/context';
import { openDatabase } from '../src/db/database';
import { email as emailSchema, newPassword, text } from '../src/lib/schemas';
import type { HostRequest } from '../src/services/host-control';
import { Funnel } from './lib/funnel';
import { ask, askHidden } from './lib/terminal';

/**
 * Inicia a mesa: é o comando (ou o atalho "Iniciar mesa") para narrar uma sessão.
 *
 *   npm run mesa                 # abre o app neste computador
 *   npm run mesa -- --publico    # já abre também para os jogadores
 *
 * Tudo o que é seu fica numa pasta só, FORA do repositório: Documentos\Cronicas de Zehenia (ou
 * ZEHENIA_HOME), com o banco, os segredos e a biblioteca de imagens e sons.
 *
 * Dois processos, de propósito:
 * - este aqui, que confia em quem está no teclado: cria a conta do dono, compila e cuida do túnel;
 * - o servidor, o único exposto à internet, com o modelo de permissões do Node: pelo próprio Node,
 *   ele não consegue ler nem gravar fora da pasta do app e não consegue executar programas. Mesmo
 *   que alguém ache uma falha no código, é até aí que ela chega. Para abrir o túnel, ele só pode
 *   pedir, a este processo, uma das operações fixas (`HostRequest`).
 *
 * Ao fechar (Ctrl+C ou fechando a janela), o túnel e o servidor caem juntos: a mesa sai da internet.
 */

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(here, '..');
const repoDir = resolve(serverDir, '..');
const frontendDir = join(repoDir, 'dist', 'zehenia', 'browser');
const bundleDir = join(serverDir, '.mesa');
const flags = new Set(process.argv.slice(2));
const port = Number(process.env['MESA_PORT'] ?? 3000);
const localUrl = `http://localhost:${port}`;

const home = resolve(process.env['ZEHENIA_HOME'] ?? join(homedir(), 'Documents', 'Cronicas de Zehenia'));
const dataDir = join(home, 'dados');
const libraryDir = join(home, 'biblioteca');
const secretsFile = join(home, 'segredos.env');

// --- Pasta do app e segredos ---------------------------------------------------------

/** Segredos gerados na primeira vez e guardados só na pasta do app. Sem eles, ninguém mais entra. */
function loadSecrets(): { TOKEN_SECRET: string; PASSWORD_PEPPER: string } {
  if (!existsSync(secretsFile)) {
    const secret = () => randomBytes(48).toString('base64url');
    writeFileSync(secretsFile, `# Segredos do app. Não compartilhe. Perder este arquivo invalida a senha do dono e as sessões.\nTOKEN_SECRET=${secret()}\nPASSWORD_PEPPER=${secret()}\n`, { mode: 0o600 });
    chmodSync(secretsFile, 0o600);
  }
  const { TOKEN_SECRET, PASSWORD_PEPPER } = parseEnv(readFileSync(secretsFile, 'utf8'));
  if (!TOKEN_SECRET || !PASSWORD_PEPPER) throw new Error(`O arquivo ${secretsFile} está incompleto.`);
  return { TOKEN_SECRET, PASSWORD_PEPPER };
}

// --- Compilação -------------------------------------------------------------------------

/** Horário do arquivo mais novo de uma pasta. */
function newest(dir: string): number {
  let latest = 0;
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    latest = Math.max(latest, item.isDirectory() ? newest(path) : statSync(path).mtimeMs);
  }
  return latest;
}

/** O app compilado existe e é mais novo que o código? Senão, compila (uma vez só, leva alguns segundos). */
function ensureFrontend(): void {
  const index = join(frontendDir, 'index.html');
  if (existsSync(index) && (flags.has('--sem-build') || statSync(index).mtimeMs >= newest(join(repoDir, 'src')))) return;
  console.log('Preparando o app (só quando o código muda)…');
  const result = spawnSync('npm', ['run', 'build'], { cwd: repoDir, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) throw new Error('Não foi possível compilar o app.');
}

// --- Conta do dono ------------------------------------------------------------------------

/** Na primeira vez, cria a conta do dono aqui no terminal: nenhuma rota do servidor faz isso. */
async function ensureOwner(env: NodeJS.ProcessEnv): Promise<void> {
  const config = loadConfig(env);
  const db = openDatabase(config.DATABASE_PATH);
  try {
    const ctx = createContext(config, db);
    if (ctx.users.owner()) return;
    console.log('\nPrimeira vez aqui: crie a SUA conta, a única que entra com senha.\n');
    const name = text(1, 60).parse(process.env['DONO_NOME'] ?? (await ask('Seu nome: ')));
    const email = emailSchema.parse(process.env['DONO_EMAIL'] ?? (await ask('E-mail para entrar (só identifica a conta): ')));
    const password = newPassword.parse(process.env['DONO_SENHA'] ?? (await askHidden('Senha (de 8 a 128 caracteres): ')));
    if (!process.env['DONO_SENHA'] && (await askHidden('Repita a senha: ')) !== password) throw new Error('As senhas não conferem.');
    await ctx.auth.setOwner({ name, email, password });
  } finally {
    db.close();
  }
}

// --- Abrir arquivos e páginas -------------------------------------------------------------

/** Abre uma página ou pasta no sistema (caminhos fixos, sem shell). */
function openInSystem(target: string): void {
  const opener = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(opener, [target], { stdio: 'ignore', detached: true }).on('error', () => undefined).unref();
}

// --- Início ---------------------------------------------------------------------------------

async function main(): Promise<void> {
  for (const dir of [home, dataDir, join(home, 'arquivos-da-mesa'), libraryDir]) mkdirSync(dir, { recursive: true });
  const funnel = new Funnel(port);
  const secrets = loadSecrets();
  const publicUrl = await funnel.publicUrl();

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...secrets,
    ZEHENIA_MESA: '1',
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(port),
    LOG_LEVEL: process.env['LOG_LEVEL'] ?? 'warn',
    DATABASE_PATH: join(dataDir, 'zehenia.db'),
    FILES_DIR: join(home, 'arquivos-da-mesa'),
    LIBRARY_DIR: libraryDir,
    FRONTEND_DIR: frontendDir,
    ALLOWED_ORIGINS: [localUrl, ...(publicUrl ? [publicUrl] : [])].join(','),
    PUBLIC_URL: publicUrl ?? localUrl,
    // O túnel chega por este computador e informa o IP real de quem está conectando
    TRUSTED_PROXIES: '127.0.0.1',
    COOKIE_SECURE: 'true',
    PASSWORD_COST: '17',
    PASSWORD_PEPPER_VERSION: '1',
    PASSWORD_PEPPERS_PREVIOUS: '',
    RATE_LIMIT: 'true',
    DEV_TOOLS: 'false',
    MAIL_PROVIDER: 'none',
    // O disco é seu: limites folgados para o dono (os convidados têm os deles)
    MAX_UPLOAD_MB: '100',
    USER_QUOTA_MB: '10000',
    TABLE_QUOTA_MB: '20000',
  };

  await ensureOwner(env);
  ensureFrontend();

  // O servidor roda de um arquivo só, compilado aqui, para não precisar executar nada depois
  const bundle = join(bundleDir, 'servidor.mjs');
  await build({ entryPoints: [join(serverDir, 'src', 'main.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', logLevel: 'error' });

  const server = spawn(
    process.execPath,
    [
      '--permission',
      `--allow-fs-read=${bundleDir}${'/'}*`,
      `--allow-fs-read=${join(serverDir, 'node_modules')}${'/'}*`,
      `--allow-fs-read=${join(serverDir, 'package.json')}`,
      `--allow-fs-read=${frontendDir}${'/'}*`,
      `--allow-fs-read=${home}${'/'}*`,
      `--allow-fs-write=${home}${'/'}*`,
      '--disable-warning=ExperimentalWarning',
      '--disable-warning=SecurityWarning',
      bundle,
    ],
    { cwd: home, env, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] },
  );

  // Pedidos do servidor: só estas operações existem, sem nenhum parâmetro vindo de fora
  server.on('message', (message: unknown) => {
    const { hostId, operation } = (message ?? {}) as Partial<HostRequest>;
    if (typeof hostId !== 'string') return;
    const reply = (status: Awaited<ReturnType<Funnel['status']>>) => server.connected && server.send({ hostId, status });
    if (operation === 'status') void funnel.status().then(reply);
    else if (operation === 'open') void funnel.open().then(reply);
    else if (operation === 'close') void funnel.close().then(reply);
    else if (operation === 'open-folder') {
      openInSystem(libraryDir);
      reply({ state: 'closed' });
    }
  });

  let stopping = false;
  const stop = (code = 0): void => {
    if (stopping) return;
    stopping = true;
    funnel.stop();
    server.kill();
    setTimeout(() => process.exit(code), 1500).unref();
  };
  process.on('SIGINT', () => stop());
  process.on('SIGTERM', () => stop());
  process.on('SIGHUP', () => stop());
  process.on('exit', () => funnel.stop());
  server.on('exit', (code) => {
    if (!stopping) console.error(`O servidor parou (código ${code}).`);
    funnel.stop();
    process.exit(code ?? 0);
  });

  // Espera o servidor responder
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if ((await fetch(`${localUrl}/api/health`).catch(() => null))?.ok) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  console.log(`
  ┌─ Crônicas de Zehenia ──────────────────────────────────────
  │  No seu computador:  ${localUrl}
  │  Sua pasta:          ${home}
  │
  │  Em Minhas mesas, use "Abrir para os jogadores".
  │  Para encerrar a sessão, feche esta janela ou aperte Ctrl+C:
  │  a mesa sai da internet na hora.
  └────────────────────────────────────────────────────────────
`);
  if (flags.has('--publico')) {
    const status = await funnel.open();
    console.log(status.state === 'open' ? `  Aberta para os jogadores: ${status.url}\n` : `  A mesa não abriu aos jogadores (${status.state}). ${status.message ?? status.approvalUrl ?? ''}\n`);
  }
  if (!flags.has('--sem-abrir')) openInSystem(localUrl);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
