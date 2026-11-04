/**
 * Atraso crescente no login (BACKEND_SECURITY.md §10), no lugar de um bloqueio fixo da conta.
 *
 * Depois de algumas falhas, cada nova falha dobra a espera até a próxima tentativa
 * (30 s, 1 min, 2 min… até 15 min). As falhas são contadas em duas chaves:
 * - e-mail + IP: quem erra a própria senha (ou ataca de um IP só) espera depois de 5 falhas;
 * - só o e-mail, com mais folga (20): ataque a uma conta vindo de muitos IPs.
 * Assim, alguém de outro IP não "tranca" a conta da vítima com poucas tentativas, e um ataque
 * distribuído contra a conta continua contido. Acertar a senha zera a chave e-mail + IP; as falhas
 * são esquecidas uma hora depois da última.
 *
 * Em memória (um processo); com várias instâncias, trocar por um armazenamento compartilhado.
 */

const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 15 * 60_000;
const FORGET_MS = 60 * 60_000;
/** Falhas toleradas antes da primeira espera, por chave. */
const FREE = { pair: 5, account: 20 } as const;

interface Failures {
  count: number;
  last: number;
}

export class LoginThrottle {
  private readonly failures = new Map<string, Failures>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Milissegundos até a próxima tentativa ser aceita (0 = pode tentar agora). */
  waitMs(email: string, ip: string): number {
    const now = this.now();
    return Math.max(this.waitOf(pairKey(email, ip), FREE.pair, now), this.waitOf(accountKey(email), FREE.account, now));
  }

  /** Registra uma senha errada (ou e-mail inexistente: a resposta é a mesma). */
  fail(email: string, ip: string): void {
    const now = this.now();
    for (const key of [pairKey(email, ip), accountKey(email)]) {
      const entry = this.current(key, now);
      this.failures.set(key, { count: (entry?.count ?? 0) + 1, last: now });
    }
    this.sweep(now);
  }

  /** Login certo: o par e-mail + IP volta a ter as tentativas livres. */
  succeed(email: string, ip: string): void {
    this.failures.delete(pairKey(email, ip));
  }

  private waitOf(key: string, free: number, now: number): number {
    const entry = this.current(key, now);
    if (!entry || entry.count < free) return 0;
    const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (entry.count - free));
    return Math.max(0, entry.last + delay - now);
  }

  /** Falhas ainda lembradas da chave (esquecidas uma hora depois da última). */
  private current(key: string, now: number): Failures | undefined {
    const entry = this.failures.get(key);
    if (entry && now - entry.last > FORGET_MS) {
      this.failures.delete(key);
      return undefined;
    }
    return entry;
  }

  /** Limpa as esquecidas de vez em quando, para o mapa não crescer sem fim. */
  private sweep(now: number): void {
    if (this.failures.size % 1000 !== 0) return;
    for (const [key, entry] of this.failures) if (now - entry.last > FORGET_MS) this.failures.delete(key);
  }
}

const pairKey = (email: string, ip: string) => `par:${email}|${ip}`;
const accountKey = (email: string) => `conta:${email}`;
