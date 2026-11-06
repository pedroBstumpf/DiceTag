import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { loadConfig } from '../src/config/env';
import { createContext } from '../src/context';
import { openDatabase } from '../src/db/database';
import { email as emailSchema, newPassword, text } from '../src/lib/schemas';
import type { HostRequest } from '../src/services/host-control';
import { appEnv, bundleDir, frontendDir, home, libraryDir, localUrl, port, repoDir, sandboxArgs, serverDir } from './lib/app-env';
import { DriveBackups, backupTarget } from './lib/drive-backup';
import { Funnel } from './lib/funnel';
import { ask, askHidden } from './lib/terminal';

/**
 * Inicia a mesa: é o comando (ou o atalho "Iniciar mesa") para narrar uma sessão.
 *
 *   npm run mesa                 # abre o app neste computador
 *   npm run mesa -- --publico    # já abre também para os jogadores
 *   npm run mesa -- --sem-backup # sem o backup automático no Google Drive
 *
 * Tudo o que é seu fica numa pasta só, fora do repositório (`lib/app-env.ts`).
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

const flags = new Set(process.argv.slice(2));

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
  const funnel = new Funnel(port);
  // Um túnel que sobrou de uma queda brusca não pode continuar aberto sem ninguém saber
  await funnel.clearLeftover();
  const env = appEnv(await funnel.publicUrl());

  await ensureOwner(env);
  ensureFrontend();

  // O servidor roda de um arquivo só, compilado aqui, para não precisar executar nada depois
  const bundle = join(bundleDir, 'servidor.mjs');
  await build({ entryPoints: [join(serverDir, 'src', 'main.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', logLevel: 'error' });

  const server = spawn(process.execPath, [...sandboxArgs(), bundle], { cwd: home, env, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });

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

  // Backup no Google Drive (lib/drive-backup.ts): sem o Drive, só avisa
  const target = flags.has('--sem-backup') ? null : backupTarget();
  const backups = target ? new DriveBackups(target) : null;

  let stopping = false;
  const stop = (code = 0): void => {
    if (stopping) return;
    stopping = true;
    // A mesa sai da internet na hora; o último backup do banco vem antes de desligar o servidor
    funnel.stop();
    void (backups?.finish() ?? Promise.resolve()).finally(() => {
      server.kill();
      setTimeout(() => process.exit(code), 1500).unref();
    });
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
  if (backups) backups.start();
  else if (!flags.has('--sem-backup')) {
    console.log('  Backup: o Google Drive para computador não foi encontrado. Instale-o (ou defina ZEHENIA_BACKUP_DIR)');
    console.log('  para ter um backup automático, cifrado, a cada sessão.\n');
  }
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
