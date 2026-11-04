import { z } from 'zod';
import { TrustedProxies } from '../lib/client-ip';
import type { Peppers } from '../security/password';

/**
 * Configuração do servidor, lida das variáveis de ambiente (arquivo `.env`, nunca versionado)
 * e validada na inicialização. Configuração inválida ou insegura = o servidor não sobe.
 *
 * Segredos (`TOKEN_SECRET`, `PASSWORD_PEPPER`) só existem aqui, no servidor: nunca vão para o
 * front-end, para logs nem para o repositório. Gere com `npm run setup`.
 */

// --- Esquema -----------------------------------------------------------------

/** "true"/"false" de variável de ambiente (z.coerce.boolean trataria "false" como true). */
const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === 'true' || v === '1'));

/** Segredo: no mínimo 32 caracteres e nunca o texto de exemplo do `.env.example`. */
const secret = z
  .string()
  .min(32, 'deve ter pelo menos 32 caracteres (gere com `npm run setup`)')
  .refine((v) => !/troque|change|example|exemplo/i.test(v), 'ainda é o valor de exemplo: gere um segredo com `npm run setup`');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Interface de rede. Padrão: só esta máquina (127.0.0.1), invisível na rede local. */
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_PATH: z.string().min(1).default('./data/zehenia.db'),
  FILES_DIR: z.string().min(1).default('./data/files'),

  /** Origens (esquema + host + porta) autorizadas a chamar a API e abrir o WebSocket. */
  ALLOWED_ORIGINS: z.string().default('http://localhost:4200,http://localhost:3000,http://127.0.0.1:3000'),

  TOKEN_SECRET: secret,
  PASSWORD_PEPPER: secret,
  /** Versão da pimenta atual (vai em cada hash novo). Ao trocar a pimenta, some 1 e guarde a antiga abaixo. */
  PASSWORD_PEPPER_VERSION: z.coerce.number().int().min(1).max(1000).default(1),
  /** Pimentas anteriores, para as senhas ainda não refeitas: `1:segredo,2:segredo`. */
  PASSWORD_PEPPERS_PREVIOUS: z.string().max(10_000).default(''),
  /** Custo do scrypt como expoente de 2 (17 = 2^17, recomendação da OWASP). Testes usam menos. */
  PASSWORD_COST: z.coerce.number().int().min(14).max(20).default(17),

  /** Cookie só por HTTPS. Navegadores aceitam cookie `Secure` em http://localhost. */
  COOKIE_SECURE: bool(true),
  /**
   * IPs ou faixas CIDR dos proxies reversos (nginx, Caddy, balanceador…) na frente do servidor,
   * separados por vírgula. Vazio = nenhum: vale o IP da conexão. Só o X-Forwarded-For escrito por
   * esses endereços é considerado (`lib/client-ip.ts`).
   */
  TRUSTED_PROXIES: z.string().max(1000).default(''),

  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(24 * 7),
  SESSION_IDLE_HOURS: z.coerce.number().int().min(1).max(24 * 7).default(24),

  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(100).default(10),
  /** Espaço total de arquivos por conta. */
  USER_QUOTA_MB: z.coerce.number().int().min(10).max(10_000).default(500),
  /** Espaço total de arquivos por mesa (somando os de todos os membros). */
  TABLE_QUOTA_MB: z.coerce.number().int().min(1).max(100_000).default(2000),

  /**
   * Pasta do app Angular já compilado (`npm run build` na raiz) para o servidor entregar junto com a
   * API, sem o `ng serve`. Vazio = só a API. Ex.: ../dist/zehenia/browser
   */
  FRONTEND_DIR: z.string().max(1000).default(''),
  /**
   * Endereço público do app, usado nos links enviados por e-mail. Vem da configuração, nunca do
   * cabeçalho Host da requisição (quem pede o link poderia apontá-lo para outro site). Vazio = a
   * primeira de ALLOWED_ORIGINS.
   */
  PUBLIC_URL: z.string().max(300).default(''),
  /**
   * Envio de e-mails: `none` (sem envio; recuperação por `npm run reset-link`), `log` (escreve no
   * terminal; só desenvolvimento) ou `resend` (API HTTP do Resend, com MAIL_API_KEY e MAIL_FROM).
   */
  MAIL_PROVIDER: z.enum(['none', 'log', 'resend']).default('none'),
  MAIL_API_KEY: z.string().max(500).default(''),
  /** Remetente, ex.: Crônicas de Zehenia <nao-responda@exemplo.com> (domínio verificado no serviço). */
  MAIL_FROM: z.string().max(300).default(''),
  /** Página de testes do WebSocket em /dev (só desenvolvimento). */
  DEV_TOOLS: bool(false),
  /** Limites de requisições (desligar só nos testes automatizados). */
  RATE_LIMIT: bool(true),
});

export type Env = z.infer<typeof schema>;

/** Configuração pronta para uso (origens, proxies e pimentas já interpretados). */
export interface Config
  extends Omit<Env, 'ALLOWED_ORIGINS' | 'TRUSTED_PROXIES' | 'PASSWORD_PEPPER' | 'PASSWORD_PEPPER_VERSION' | 'PASSWORD_PEPPERS_PREVIOUS' | 'PUBLIC_URL'> {
  allowedOrigins: ReadonlySet<string>;
  /** Origem pública do app (sem barra no fim): sempre uma das origens autorizadas. */
  publicUrl: string;
  trustedProxies: TrustedProxies;
  peppers: Peppers;
  isProduction: boolean;
}

// --- Leitura -----------------------------------------------------------------

/** Lê e valida a configuração. Lança erro com a lista de problemas (sem mostrar os valores). */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  // TRUST_PROXY=true confiava em qualquer X-Forwarded-For: quem usava precisa listar os proxies
  if (source['TRUST_PROXY'] !== undefined && !['false', '0'].includes(source['TRUST_PROXY'])) {
    throw new Error('Configuração inválida (arquivo .env):\n  - TRUST_PROXY foi substituído por TRUSTED_PROXIES (IPs ou faixas CIDR dos proxies).');
  }
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuração inválida (arquivo .env):\n${problems}`);
  }
  const { ALLOWED_ORIGINS, TRUSTED_PROXIES, PASSWORD_PEPPER, PASSWORD_PEPPER_VERSION, PASSWORD_PEPPERS_PREVIOUS, PUBLIC_URL, ...env } = parsed.data;
  const allowedOrigins = parseOrigins(ALLOWED_ORIGINS);
  const publicUrl = PUBLIC_URL.replace(/\/$/, '') || [...allowedOrigins][0];
  if (!allowedOrigins.has(publicUrl)) throw new Error('PUBLIC_URL precisa ser uma das origens de ALLOWED_ORIGINS.');
  if (env.MAIL_PROVIDER === 'resend' && (env.MAIL_API_KEY.length < 10 || !env.MAIL_FROM)) throw new Error('MAIL_PROVIDER=resend precisa de MAIL_API_KEY e MAIL_FROM.');
  const config: Config = {
    ...env,
    allowedOrigins,
    publicUrl,
    trustedProxies: parseProxies(TRUSTED_PROXIES),
    peppers: { version: PASSWORD_PEPPER_VERSION, current: PASSWORD_PEPPER, previous: parsePeppers(PASSWORD_PEPPERS_PREVIOUS, PASSWORD_PEPPER_VERSION) },
    isProduction: env.NODE_ENV === 'production',
  };
  assertSafeForProduction(config);
  return config;
}

/** "127.0.0.1, 10.0.0.0/8" → proxies confiáveis (rejeita endereço ou faixa inválidos). */
function parseProxies(raw: string): TrustedProxies {
  const entries = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  try {
    return new TrustedProxies(entries);
  } catch (err) {
    throw new Error(`TRUSTED_PROXIES: ${(err as Error).message}.`);
  }
}

/** "1:segredo,2:segredo" → pimentas anteriores por versão (cada uma com as regras de segredo). */
function parsePeppers(raw: string, currentVersion: number): ReadonlyMap<number, string> {
  const peppers = new Map<number, string>();
  for (const item of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const match = /^(\d+):(.+)$/.exec(item);
    const version = Number(match?.[1]);
    if (!match || !Number.isInteger(version) || version < 1 || version === currentVersion || peppers.has(version)) {
      throw new Error('PASSWORD_PEPPERS_PREVIOUS: use "<versão>:<segredo>", versões únicas e diferentes da atual.');
    }
    const checked = secret.safeParse(match[2]);
    if (!checked.success) throw new Error(`PASSWORD_PEPPERS_PREVIOUS (versão ${version}): ${checked.error.issues[0].message}.`);
    peppers.set(version, match[2]);
  }
  return peppers;
}

/** "http://a:1, https://b" → conjunto de origens normalizadas (rejeita caminhos e curingas). */
function parseOrigins(raw: string): ReadonlySet<string> {
  const origins = new Set<string>();
  for (const item of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (item === '*' || item.includes('*')) throw new Error('ALLOWED_ORIGINS não aceita curinga (*).');
    let url: URL;
    try {
      url = new URL(item);
    } catch {
      throw new Error(`ALLOWED_ORIGINS: origem inválida "${item}".`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`ALLOWED_ORIGINS: use http(s) em "${item}".`);
    if (url.origin !== item.replace(/\/$/, '')) throw new Error(`ALLOWED_ORIGINS: só a origem, sem caminho, em "${item}".`);
    origins.add(url.origin);
  }
  if (!origins.size) throw new Error('ALLOWED_ORIGINS está vazio.');
  return origins;
}

/** Em produção, recusa configurações que só fazem sentido localmente. */
function assertSafeForProduction(config: Config): void {
  if (!config.isProduction) return;
  const problems: string[] = [];
  if (!config.COOKIE_SECURE) problems.push('COOKIE_SECURE precisa ser true');
  if (config.DEV_TOOLS) problems.push('DEV_TOOLS precisa ser false');
  if (!config.RATE_LIMIT) problems.push('RATE_LIMIT precisa ser true');
  if (config.PASSWORD_COST < 17) problems.push('PASSWORD_COST precisa ser 17 ou mais');
  // O texto do e-mail leva o link de recuperação de senha, que não pode ir para o log
  if (config.MAIL_PROVIDER === 'log') problems.push('MAIL_PROVIDER não pode ser log');
  const peppers = [config.peppers.current, ...(config.peppers.previous?.values() ?? [])];
  if (peppers.includes(config.TOKEN_SECRET)) problems.push('TOKEN_SECRET e as pimentas (PASSWORD_PEPPER*) precisam ser diferentes');
  for (const origin of config.allowedOrigins) {
    if (!origin.startsWith('https://')) problems.push(`origem sem HTTPS: ${origin}`);
  }
  if (problems.length) throw new Error(`Configuração insegura para produção:\n  - ${problems.join('\n  - ')}`);
}
