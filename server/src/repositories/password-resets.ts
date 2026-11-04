import { transaction, type Db } from '../db/database';

export interface PasswordResetRecord {
  userId: string;
  createdAt: number;
  expiresAt: number;
}

/**
 * Pedidos de recuperação de senha, indexados pelo HMAC do token (BACKEND_SECURITY.md §1): o token
 * em si só existe no link enviado. Cada conta tem no máximo um pedido válido, o mais recente.
 */
export class PasswordResetsRepository {
  constructor(private readonly db: Db) {}

  /** Guarda o pedido no lugar dos anteriores da conta (só o link mais novo vale). */
  replace(tokenHash: string, userId: string, now: number, expiresAt: number): void {
    transaction(this.db, () => {
      this.deleteForUser(userId);
      this.db.prepare('INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(tokenHash, userId, now, expiresAt);
    });
  }

  find(tokenHash: string): PasswordResetRecord | null {
    const row = this.db.prepare('SELECT user_id, created_at, expires_at FROM password_resets WHERE token_hash = ?').get(tokenHash) as ResetRow | undefined;
    return row ? { userId: row.user_id, createdAt: row.created_at, expiresAt: row.expires_at } : null;
  }

  /** Quando a conta pediu pela última vez (null = não há pedido em aberto). */
  lastRequestAt(userId: string): number | null {
    const row = this.db.prepare('SELECT created_at FROM password_resets WHERE user_id = ?').get(userId) as { created_at: number } | undefined;
    return row?.created_at ?? null;
  }

  /** Gasta o pedido, se ainda valer: uma instrução só, então dois envios do mesmo link não passam juntos. */
  consume(tokenHash: string, now: number): boolean {
    return Number(this.db.prepare('DELETE FROM password_resets WHERE token_hash = ? AND expires_at > ?').run(tokenHash, now).changes) > 0;
  }

  deleteForUser(userId: string): void {
    this.db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(userId);
  }

  deleteExpired(now: number): number {
    return Number(this.db.prepare('DELETE FROM password_resets WHERE expires_at <= ?').run(now).changes);
  }
}

interface ResetRow {
  user_id: string;
  created_at: number;
  expires_at: number;
}
