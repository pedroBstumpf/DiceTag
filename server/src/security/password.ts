import { createHmac, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { Semaphore } from '../lib/limiter';

/**
 * Hash de senhas com scrypt (nativo do Node), seguindo a OWASP (BACKEND_SECURITY.md §1):
 * - custo N = 2^17, r = 8, p = 1 (configurável em PASSWORD_COST);
 * - sal aleatório de 16 bytes por senha;
 * - "pimenta": HMAC-SHA256 da senha com um segredo que fica fora do banco. Quem roubar só o
 *   banco não consegue testar senhas offline;
 * - comparação em tempo constante (`timingSafeEqual`);
 * - no máximo 4 hashes ao mesmo tempo (cada um usa ~128 MB de RAM).
 *
 * Formato autodescritivo: `scrypt$<versão da pimenta>$N=131072,r=8,p=1$<sal base64>$<hash base64>`.
 * Custo e pimenta ficam no hash, então dá para subir o custo ou trocar a pimenta sem invalidar as
 * senhas: as pimentas anteriores continuam configuradas (PASSWORD_PEPPERS_PREVIOUS) e cada hash
 * antigo é refeito no próximo login (`needsRehash`). O formato anterior,
 * `scrypt$<logN>$<r>$<p>$<sal>$<hash>`, vale como feito com a pimenta da versão 1.
 */

/** Pimentas do servidor: a atual (usada nos hashes novos) e as anteriores, por versão. */
export interface Peppers {
  version: number;
  current: string;
  previous?: ReadonlyMap<number, string>;
}

const KEY_LENGTH = 64;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const hashing = new Semaphore(4, 200);

/** Hash salvo, já interpretado. */
interface StoredHash {
  version: number;
  logN: number;
  r: number;
  p: number;
  salt: Buffer;
  key: Buffer;
  legacy: boolean;
}

function scryptAsync(password: Buffer, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEY_LENGTH, options, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** Interpreta um hash salvo (null se malformado ou com parâmetros fora dos limites). */
function parseStored(stored: string): StoredHash | null {
  const parts = stored.split('$');
  if (parts[0] !== 'scrypt') return null;
  let version: number;
  let logN: number;
  let r: number;
  let p: number;
  let salt: string;
  let key: string;
  const legacy = parts.length === 6;
  if (legacy) {
    [logN, r, p] = parts.slice(1, 4).map(Number);
    version = 1;
    [salt, key] = parts.slice(4);
  } else if (parts.length === 5) {
    const params = /^N=(\d+),r=(\d+),p=(\d+)$/.exec(parts[2]);
    if (!params || !/^\d+$/.test(parts[1])) return null;
    version = Number(parts[1]);
    const N = Number(params[1]);
    logN = Math.log2(N);
    r = Number(params[2]);
    p = Number(params[3]);
    [salt, key] = parts.slice(3);
  } else {
    return null;
  }
  if (![version, logN, r, p].every(Number.isInteger) || logN < 10 || logN > 22 || r < 1 || r > 32 || p < 1 || p > 16) return null;
  const keyBytes = Buffer.from(key, 'base64');
  if (keyBytes.length !== KEY_LENGTH) return null;
  return { version, logN, r, p, salt: Buffer.from(salt, 'base64'), key: keyBytes, legacy };
}

export class PasswordHasher {
  constructor(
    private readonly peppers: Peppers,
    private readonly logCost: number,
  ) {}

  /** Gera o hash de uma senha nova (pimenta e custo atuais). */
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const key = await this.derive(password, this.peppers.current, salt, this.logCost, BLOCK_SIZE, PARALLELISM);
    const params = `N=${2 ** this.logCost},r=${BLOCK_SIZE},p=${PARALLELISM}`;
    return ['scrypt', this.peppers.version, params, salt.toString('base64'), key.toString('base64')].join('$');
  }

  /** Confere a senha. Hash malformado ou de pimenta desconhecida = false (nunca lança por causa do conteúdo salvo). */
  async verify(password: string, stored: string): Promise<boolean> {
    const parsed = parseStored(stored);
    const pepper = parsed && this.pepperOf(parsed.version);
    if (!parsed || !pepper) return false;
    const key = await this.derive(password, pepper, parsed.salt, parsed.logN, parsed.r, parsed.p);
    return timingSafeEqual(key, parsed.key);
  }

  /** O hash usa outro formato, outra pimenta ou outro custo? (refazer no próximo login) */
  needsRehash(stored: string): boolean {
    const parsed = parseStored(stored);
    return (
      !parsed ||
      parsed.legacy ||
      parsed.version !== this.peppers.version ||
      parsed.logN !== this.logCost ||
      parsed.r !== BLOCK_SIZE ||
      parsed.p !== PARALLELISM
    );
  }

  /**
   * Gasta o mesmo tempo de uma verificação real. Usado no login quando o e-mail não existe:
   * a resposta demora igual e não revela quais e-mails têm conta.
   */
  async dummyVerify(password: string): Promise<void> {
    await this.derive(password, this.peppers.current, randomBytes(16), this.logCost, BLOCK_SIZE, PARALLELISM);
  }

  private pepperOf(version: number): string | undefined {
    return version === this.peppers.version ? this.peppers.current : this.peppers.previous?.get(version);
  }

  private derive(password: string, pepper: string, salt: Buffer, logN: number, r: number, p: number): Promise<Buffer> {
    const peppered = createHmac('sha256', pepper).update(password.normalize('NFKC'), 'utf8').digest();
    const N = 2 ** logN;
    // maxmem precisa caber 128 * N * r bytes (com folga)
    return hashing.run(() => scryptAsync(peppered, salt, { N, r, p, maxmem: 256 * N * r }));
  }
}

// --- Política de senha -------------------------------------------------------

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

/** Senhas mais vazadas (lista curta: a recomendação do NIST é recusar senhas conhecidas). */
const COMMON_PASSWORDS = new Set([
  '12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', '12341234', '11223344',
  'password', 'password1', 'passw0rd', 'iloveyou', 'qwertyui', 'qwerty123', 'abc12345', 'abcd1234',
  'senha123', 'senha1234', 'mudar123', 'admin123', 'administrador', 'brasil123', 'flamengo', 'corinthians',
  'palmeiras', 'zehenia1', 'zehenia123', 'dicetag1', 'dicetag123', 'welcome1', 'sunshine', 'football',
]);

/** Motivo pelo qual a senha é recusada, ou null se aceitável. */
export function passwordProblem(password: string, email: string): string | null {
  if (password.length < PASSWORD_MIN) return `A senha precisa ter pelo menos ${PASSWORD_MIN} caracteres.`;
  if (password.length > PASSWORD_MAX) return `A senha pode ter no máximo ${PASSWORD_MAX} caracteres.`;
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return 'Essa senha é muito comum. Escolha outra.';
  if (/^(.)\1+$/.test(password)) return 'A senha não pode ser um único caractere repetido.';
  if (lower === email.toLowerCase() || lower === email.split('@')[0].toLowerCase()) return 'A senha não pode ser o seu e-mail.';
  return null;
}
