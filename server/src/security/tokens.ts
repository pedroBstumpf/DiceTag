import { createHmac, randomBytes } from 'node:crypto';

/**
 * Tokens opacos (sessão, convite): 32 bytes aleatórios do gerador criptográfico do sistema.
 *
 * O banco guarda só o HMAC-SHA256 do token com TOKEN_SECRET. Assim:
 * - vazar o banco não entrega sessões nem convites válidos;
 * - a busca é por igualdade do hash (sem comparar o token em si, sem vazamento por tempo);
 * - trocar TOKEN_SECRET invalida todas as sessões de uma vez (logout geral de emergência).
 */
export class TokenService {
  constructor(private readonly secret: string) {}

  /** Novo token aleatório (base64url, seguro em cookie e URL). */
  generate(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }

  /** HMAC do token para guardar/buscar no banco. `purpose` separa sessões, convites e o log. */
  hash(token: string, purpose: 'session' | 'invite' | 'audit'): string {
    return createHmac('sha256', this.secret).update(`${purpose}:${token}`).digest('hex');
  }

  /** Referência curta e não reversível de um dado pessoal (ex.: e-mail tentado no login) para o log. */
  ref(value: string): string {
    return this.hash(value, 'audit').slice(0, 16);
  }
}
