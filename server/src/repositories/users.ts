import type { Db } from '../db/database';

/** Dono do app (único, entra com senha) ou convidado (entra por link, sem senha nem e-mail). */
export type UserKind = 'owner' | 'guest';

/** Conta como vista pelo cliente (nunca inclui o hash da senha). */
export interface PublicUser {
  id: string;
  name: string;
  /** Vazio nos convidados, que não têm e-mail. */
  email: string;
  kind: UserKind;
  createdAt: number;
}

/**
 * Prefixo do "e-mail" guardado nos convidados: a coluna é obrigatória e única, e este valor nunca
 * passa pela validação de e-mail do login, então não há como entrar com ele.
 */
const GUEST_EMAIL_PREFIX = 'convidado:';
/** "Hash" dos convidados: não é um hash válido, então nenhuma senha confere. */
const NO_PASSWORD = '!';

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  kind: UserKind;
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
      .prepare('INSERT INTO users (id, email, name, password_hash, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(user.id, user.email, user.name, user.passwordHash, user.kind, user.createdAt);
  }

  /** Conta de convidado: só nome e id, sem e-mail nem senha. */
  createGuest(id: string, name: string, now: number): PublicUser {
    this.create({ id, name, email: GUEST_EMAIL_PREFIX + id, kind: 'guest', passwordHash: NO_PASSWORD, createdAt: now });
    return { id, name, email: '', kind: 'guest', createdAt: now };
  }

  /** O dono do app (null = ainda não foi criado). */
  owner(): PublicUser | null {
    const row = this.db.prepare("SELECT * FROM users WHERE kind = 'owner'").get() as UserRow | undefined;
    return row ? toPublic(row) : null;
  }

  /** Muda o nome e o e-mail do dono (só pelo terminal: `npm run dono`). */
  updateOwner(id: string, name: string, email: string): void {
    this.db.prepare("UPDATE users SET name = ?, email = ? WHERE id = ? AND kind = 'owner'").run(name, email, id);
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
  return { id: row.id, name: row.name, email: row.email.startsWith(GUEST_EMAIL_PREFIX) ? '' : row.email, kind: row.kind, createdAt: row.created_at };
}
