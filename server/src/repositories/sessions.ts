import { transaction, type Db } from '../db/database';

export interface SessionRecord {
  userId: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
}

/** Máximo de sessões abertas por conta (as mais antigas saem). */
export const MAX_SESSIONS_PER_USER = 10;

/**
 * Sessões de login, indexadas pelo HMAC do token (o token em si nunca é guardado).
 * Expiração absoluta (`expires_at`) e por inatividade (`last_seen_at`, conferida no serviço).
 */
export class SessionsRepository {
  constructor(private readonly db: Db) {}

  /** Abre a sessão e, na mesma transação, apaga as mais antigas além do máximo da conta. */
  create(tokenHash: string, userId: string, now: number, expiresAt: number): void {
    transaction(this.db, () => {
      this.db
        .prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)')
        .run(tokenHash, userId, now, now, expiresAt);
      this.db
        .prepare(
          `DELETE FROM sessions WHERE user_id = ? AND token_hash NOT IN (
             SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
           )`,
        )
        .run(userId, userId, MAX_SESSIONS_PER_USER);
    });
  }

  find(tokenHash: string): SessionRecord | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(tokenHash) as
      | { user_id: string; created_at: number; last_seen_at: number; expires_at: number }
      | undefined;
    return row ? { userId: row.user_id, createdAt: row.created_at, lastSeenAt: row.last_seen_at, expiresAt: row.expires_at } : null;
  }

  touch(tokenHash: string, now: number): void {
    this.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(now, tokenHash);
  }

  delete(tokenHash: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  /** Encerra todas as sessões da conta (troca de senha, sair de todos os dispositivos). */
  deleteAllForUser(userId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }

  /**
   * Limpeza periódica das vencidas. A inatividade só vale para quem tem senha: o convidado não tem
   * como entrar de novo sozinho, então a sessão dele só termina no prazo total.
   */
  deleteExpired(now: number, idleMs: number): number {
    return Number(
      this.db
        .prepare(
          `DELETE FROM sessions WHERE expires_at <= ?
           OR (last_seen_at <= ? AND user_id NOT IN (SELECT id FROM users WHERE kind = 'guest'))`,
        )
        .run(now, now - idleMs).changes,
    );
  }
}
