import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

/**
 * Onde o app guarda o que é do dono e como ele roda, num lugar só (`npm run mesa`, `npm run dono`,
 * `npm run reset-link`). Tudo fica numa pasta FORA do repositório: Documentos\Cronicas de Zehenia,
 * ou ZEHENIA_HOME. Assim, nem um "commit all" nem a troca de branch alcançam banco, segredos e arquivos.
 */
const here = dirname(fileURLToPath(import.meta.url));
export const serverDir = resolve(here, '..', '..');
export const repoDir = resolve(serverDir, '..');
export const frontendDir = join(repoDir, 'dist', 'zehenia', 'browser');
export const bundleDir = join(serverDir, '.mesa');

export const home = resolve(process.env['ZEHENIA_HOME'] ?? join(homedir(), 'Documents', 'Cronicas de Zehenia'));
export const libraryDir = join(home, 'biblioteca');
const dataDir = join(home, 'dados');
const tableFilesDir = join(home, 'arquivos-da-mesa');
const secretsFile = join(home, 'segredos.env');

export const port = Number(process.env['MESA_PORT'] ?? 3000);
export const localUrl = `http://localhost:${port}`;

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

/** Configuração completa do app: nada vem do `.env` de desenvolvimento. */
export function appEnv(publicUrl?: string): NodeJS.ProcessEnv {
  for (const dir of [home, dataDir, tableFilesDir, libraryDir]) mkdirSync(dir, { recursive: true });
  return {
    ...process.env,
    ...loadSecrets(),
    // Canal com o processo principal (só `npm run mesa` abre)
    ZEHENIA_MESA: '1',
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(port),
    LOG_LEVEL: process.env['LOG_LEVEL'] ?? 'warn',
    DATABASE_PATH: join(dataDir, 'zehenia.db'),
    FILES_DIR: tableFilesDir,
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
    // O disco é do dono: limites folgados para ele (os convidados têm os deles)
    MAX_UPLOAD_MB: '100',
    USER_QUOTA_MB: '10000',
    TABLE_QUOTA_MB: '20000',
  };
}

/**
 * Argumentos do modelo de permissões do Node para o servidor exposto: ele só lê o próprio código, o
 * app compilado e a pasta do app, só grava na pasta do app e não executa programas (não há
 * `--allow-child-process`). O resto do computador, inclusive este repositório, não existe para ele.
 */
export function sandboxArgs(): string[] {
  return [
    '--permission',
    `--allow-fs-read=${bundleDir}/*`,
    `--allow-fs-read=${join(serverDir, 'node_modules')}/*`,
    `--allow-fs-read=${join(serverDir, 'package.json')}`,
    `--allow-fs-read=${frontendDir}/*`,
    `--allow-fs-read=${home}/*`,
    `--allow-fs-write=${home}/*`,
    '--disable-warning=ExperimentalWarning',
    '--disable-warning=SecurityWarning',
  ];
}
