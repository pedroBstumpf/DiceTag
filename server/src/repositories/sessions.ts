import type { Db } from '../db/database';

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

  create(tokenHash: string, userId: string, now: number, expiresAt: number): void {
    this.db
      .prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(tokenHash, userId, now, now, expiresAt);
    // Limita sessões por conta: apaga as mais antigas além do máximo
    this.db
      .prepare(
        `DELETE FROM sessions WHERE user_id = ? AND token_hash NOT IN (
           SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
         )`,
      )
      .run(userId, userId, MAX_SESSIONS_PER_USER);
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

  /** Encerra todas as sessões da conta, menos `keep` (ex.: depois de trocar a senha). */
  deleteAllForUser(userId: string, keep?: string): void {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, keep ?? '');
  }

  /** Limpeza periódica das vencidas. */
  deleteExpired(now: number, idleMs: number): number {
    return Number(this.db.prepare('DELETE FROM sessions WHERE expires_at <= ? OR last_seen_at <= ?').run(now, now - idleMs).changes);
  }
}
