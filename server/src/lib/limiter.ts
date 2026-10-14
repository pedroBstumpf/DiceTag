/**
 * Limitadores de taxa em memória (um processo). Usados onde o `@fastify/rate-limit` não alcança:
 * tentativas de login por e-mail, abertura de WebSocket por IP e mensagens por conexão.
 *
 * Em várias instâncias do servidor, trocar por um armazenamento compartilhado (Redis).
 */

// --- Janela fixa por chave ---------------------------------------------------

/** Conta eventos por chave numa janela de tempo; acima do máximo, recusa até a janela virar. */
export class WindowLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Registra um evento. false = passou do limite (o evento não deve ser atendido). */
  hit(key: string): boolean {
    const now = this.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      this.sweep(now);
      return true;
    }
    entry.count++;
    return entry.count <= this.max;
  }

  /** Já está bloqueado? (sem registrar evento) */
  blocked(key: string): boolean {
    const entry = this.hits.get(key);
    return !!entry && entry.resetAt > this.now() && entry.count >= this.max;
  }

  /** Esquece a chave (ex.: login bem-sucedido zera as falhas daquele e-mail). */
  reset(key: string): void {
    this.hits.delete(key);
  }

  /** Remove janelas vencidas para o mapa não crescer sem fim (a cada 1000 chaves novas). */
  private sweep(now: number): void {
    if (this.hits.size % 1000 !== 0) return;
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
  }
}

// --- Balde de fichas (mensagens por conexão) ----------------------------------

/** Permite rajadas curtas (`burst`) e uma taxa média (`perSecond`). */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly perSecond: number,
    private readonly burst: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = burst;
    this.last = now();
  }

  /** Gasta `cost` fichas. false = sem fichas (mensagem deve ser recusada). */
  take(cost = 1): boolean {
    const now = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}

// --- Concorrência ------------------------------------------------------------

/**
 * Semáforo: no máximo `limit` tarefas ao mesmo tempo (as demais esperam na fila, até `maxQueue`).
 * Usado no hash de senha (scrypt usa muita memória: sem limite, muitos logins simultâneos
 * esgotariam a RAM do servidor).
 */
export class Semaphore {
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(
    private readonly limit: number,
    private readonly maxQueue: number,
  ) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      if (this.queue.length >= this.maxQueue) throw new Error('Servidor ocupado.');
      // A vaga é passada direto por quem terminou (`active` não muda): ninguém fura a fila
      await new Promise<void>((resolve) => this.queue.push(resolve));
    } else {
      this.active++;
    }
    try {
      return await task();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active--;
    }
  }
}
