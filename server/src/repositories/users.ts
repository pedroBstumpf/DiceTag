import type { Db } from '../db/database';

/** Conta como vista pelo cliente (nunca inclui o hash da senha). */
export interface PublicUser {
  id: string;
  name: string;
  email: string;
  createdAt: number;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  created_at: number;
}

/**
 * Contas. E-mail guardado já normalizado (minúsculas, sem espaços), único no banco.
 * O hash da senha só sai deste repositório por `credentialsByEmail`/`passwordHashOf`.
 */
export class UsersRepository {
  constructor(private readonly db: Db) {}

  create(user: PublicUser & { passwordHash: string }): void {
    this.db
      .prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(user.id, user.email, user.name, user.passwordHash, user.createdAt);
  }

  emailTaken(email: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM users WHERE email = ?').get(email);
  }

  findById(id: string): PublicUser | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return row ? toPublic(row) : null;
  }

  /** Para o login: a conta e o hash (null = e-mail sem conta). */
  credentialsByEmail(email: string): { user: PublicUser; passwordHash: string } | null {
    const row = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
    return row ? { user: toPublic(row), passwordHash: row.password_hash } : null;
  }

  passwordHashOf(id: string): string | null {
    const row = this.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(id) as { password_hash: string } | undefined;
    return row?.password_hash ?? null;
  }

  setPasswordHash(id: string, passwordHash: string): void {
    this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
  }

  rename(id: string, name: string): void {
    this.db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, id);
  }

  /** Exclui a conta; sessões, mundos (com os itens), participações e arquivos saem em cascata. */
  delete(id: string): boolean {
    return Number(this.db.prepare('DELETE FROM users WHERE id = ?').run(id).changes) > 0;
  }
}

function toPublic(row: UserRow): PublicUser {
  return { id: row.id, name: row.name, email: row.email, createdAt: row.created_at };
}
