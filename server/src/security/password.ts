import { createHmac, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { Semaphore } from '../lib/limiter';

/**
 * Hash de senhas com scrypt (nativo do Node), seguindo a OWASP:
 * - custo N = 2^17, r = 8, p = 1 (configurável em PASSWORD_COST; o custo fica salvo no hash,
 *   então hashes antigos continuam válidos se o custo mudar);
 * - sal aleatório de 16 bytes por senha;
 * - "pimenta" (PASSWORD_PEPPER): HMAC da senha com um segredo que fica fora do banco. Quem
 *   roubar só o banco não consegue testar senhas offline;
 * - comparação em tempo constante (`timingSafeEqual`);
 * - no máximo 4 hashes ao mesmo tempo (cada um usa ~128 MB de RAM).
 *
 * Formato salvo: `scrypt$<logN>$<r>$<p>$<sal base64>$<hash base64>`.
 */

const KEY_LENGTH = 64;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const hashing = new Semaphore(4, 200);

function scryptAsync(password: Buffer, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEY_LENGTH, options, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export class PasswordHasher {
  constructor(
    private readonly pepper: string,
    private readonly logCost: number,
  ) {}

  /** Gera o hash de uma senha nova. */
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const key = await this.derive(password, salt, this.logCost, BLOCK_SIZE, PARALLELISM);
    return ['scrypt', this.logCost, BLOCK_SIZE, PARALLELISM, salt.toString('base64'), key.toString('base64')].join('$');
  }

  /** Confere a senha. Hash malformado = false (nunca lança por causa do conteúdo salvo). */
  async verify(password: string, stored: string): Promise<boolean> {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [logN, r, p] = parts.slice(1, 4).map(Number);
    if (![logN, r, p].every(Number.isInteger) || logN < 10 || logN > 22 || r < 1 || r > 32 || p < 1 || p > 16) return false;
    const salt = Buffer.from(parts[4], 'base64');
    const expected = Buffer.from(parts[5], 'base64');
    if (expected.length !== KEY_LENGTH) return false;
    const key = await this.derive(password, salt, logN, r, p);
    return timingSafeEqual(key, expected);
  }

  /** O hash foi feito com um custo diferente do atual? (refazer no próximo login) */
  needsRehash(stored: string): boolean {
    const [, logN, r, p] = stored.split('$');
    return Number(logN) !== this.logCost || Number(r) !== BLOCK_SIZE || Number(p) !== PARALLELISM;
  }

  /**
   * Gasta o mesmo tempo de uma verificação real. Usado no login quando o e-mail não existe:
   * a resposta demora igual e não revela quais e-mails têm conta.
   */
  async dummyVerify(password: string): Promise<void> {
    await this.derive(password, randomBytes(16), this.logCost, BLOCK_SIZE, PARALLELISM);
  }

  private derive(password: string, salt: Buffer, logN: number, r: number, p: number): Promise<Buffer> {
    const peppered = createHmac('sha256', this.pepper).update(password.normalize('NFKC'), 'utf8').digest();
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
