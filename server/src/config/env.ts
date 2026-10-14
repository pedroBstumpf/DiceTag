import { z } from 'zod';

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
  /** Custo do scrypt como expoente de 2 (17 = 2^17, recomendação da OWASP). Testes usam menos. */
  PASSWORD_COST: z.coerce.number().int().min(14).max(20).default(17),

  /** Cookie só por HTTPS. Navegadores aceitam cookie `Secure` em http://localhost. */
  COOKIE_SECURE: bool(true),
  /** Atrás de um proxy reverso (nginx, Caddy…): confiar no X-Forwarded-For para o IP real. */
  TRUST_PROXY: bool(false),

  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(24 * 7),
  SESSION_IDLE_HOURS: z.coerce.number().int().min(1).max(24 * 7).default(24),

  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(100).default(10),
  /** Espaço total de arquivos por conta. */
  USER_QUOTA_MB: z.coerce.number().int().min(10).max(10_000).default(500),

  /** Página de testes do WebSocket em /dev (só desenvolvimento). */
  DEV_TOOLS: bool(false),
  /** Limites de requisições (desligar só nos testes automatizados). */
  RATE_LIMIT: bool(true),
});

export type Env = z.infer<typeof schema>;

/** Configuração pronta para uso (origens já interpretadas). */
export interface Config extends Omit<Env, 'ALLOWED_ORIGINS'> {
  allowedOrigins: ReadonlySet<string>;
  isProduction: boolean;
}

// --- Leitura -----------------------------------------------------------------

/** Lê e valida a configuração. Lança erro com a lista de problemas (sem mostrar os valores). */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuração inválida (arquivo .env):\n${problems}`);
  }
  const { ALLOWED_ORIGINS, ...env } = parsed.data;
  const config: Config = {
    ...env,
    allowedOrigins: parseOrigins(ALLOWED_ORIGINS),
    isProduction: env.NODE_ENV === 'production',
  };
  assertSafeForProduction(config);
  return config;
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
  if (config.TOKEN_SECRET === config.PASSWORD_PEPPER) problems.push('TOKEN_SECRET e PASSWORD_PEPPER precisam ser diferentes');
  for (const origin of config.allowedOrigins) {
    if (!origin.startsWith('https://')) problems.push(`origem sem HTTPS: ${origin}`);
  }
  if (problems.length) throw new Error(`Configuração insegura para produção:\n  - ${problems.join('\n  - ')}`);
}
