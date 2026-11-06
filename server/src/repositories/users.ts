import type { Db } from '../db/database';

/** Dono do app (único, entra com e-mail e senha) ou convidado (entra por convite e, com senha, pelo nome). */
export type UserKind = 'owner' | 'guest';

/** Conta como vista pelo cliente (nunca inclui o hash da senha). */
export interface PublicUser {
  id: string;
  name: string;
  /** Vazio nos convidados, que não têm e-mail. */
  email: string;
  kind: UserKind;
  createdAt: number;
  /** Tem senha? (o dono sempre; convidados antigos podem não ter: o menu oferece "Criar senha") */
  hasPassword: boolean;
}

/** Credenciais do convidado: nome de entrada normalizado e hash da senha (calculado fora da transação). */
export interface GuestCredentials {
  loginName: string;
  passwordHash: string;
}

/** Mensagem do nome de entrada repetido (409). */
export const NAME_TAKEN = 'Esse nome já está em uso. Escolha outro.';

/**
 * Prefixo do "e-mail" guardado nos convidados: a coluna é obrigatória e única, e este valor nunca
 * passa pela validação de e-mail do login, então não há como entrar com ele.
 */
const GUEST_EMAIL_PREFIX = 'convidado:';
/** "Hash" dos convidados sem senha: não é um hash válido, então nenhuma senha confere. */
const NO_PASSWORD = '!';

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  kind: UserKind;
  created_at: number;
  login_name: string | null;
}

/** O banco recusou um valor repetido num índice único (ex.: dois convidados com o mesmo nome ao mesmo tempo). */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
}

/**
 * Contas. E-mail guardado já normalizado (minúsculas, sem espaços), único no banco; o nome de
 * entrada dos convidados (`login_name`) também é único.
 * O hash da senha só sai deste repositório por `credentialsByEmail`/`credentialsByLogin`/`passwordHashOf`.
 */
export class UsersRepository {
  constructor(private readonly db: Db) {}

  create(user: Omit<PublicUser, 'hasPassword'> & { passwordHash: string; loginName?: string }): void {
    this.db
      .prepare('INSERT INTO users (id, email, name, password_hash, kind, created_at, login_name) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(user.id, user.email, user.name, user.passwordHash, user.kind, user.createdAt, user.loginName ?? null);
  }

  /** Conta de convidado: nome e id, sem e-mail. Sem `credentials`, sem senha (como os convidados antigos). */
  createGuest(id: string, name: string, now: number, credentials?: GuestCredentials): PublicUser {
    this.create({
      id,
      name,
      email: GUEST_EMAIL_PREFIX + id,
      kind: 'guest',
      passwordHash: credentials?.passwordHash ?? NO_PASSWORD,
      loginName: credentials?.loginName,
      createdAt: now,
    });
    return { id, name, email: '', kind: 'guest', createdAt: now, hasPassword: !!credentials };
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

  /** Algum convidado (fora `exceptId`) já entra com este nome? */
  loginTaken(loginName: string, exceptId?: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM users WHERE login_name = ? AND id IS NOT ?').get(loginName, exceptId ?? null);
  }

  findById(id: string): PublicUser | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return row ? toPublic(row) : null;
  }

  /** Para o login do dono: a conta e o hash (null = e-mail sem conta). */
  credentialsByEmail(email: string): { user: PublicUser; passwordHash: string } | null {
    const row = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
    return row ? { user: toPublic(row), passwordHash: row.password_hash } : null;
  }

  /** Para o login do convidado: a conta e o hash pelo nome de entrada (null = nome sem conta). */
  credentialsByLogin(loginName: string): { user: PublicUser; passwordHash: string } | null {
    const row = this.db.prepare("SELECT * FROM users WHERE login_name = ? AND kind = 'guest'").get(loginName) as UserRow | undefined;
    return row ? { user: toPublic(row), passwordHash: row.password_hash } : null;
  }

  passwordHashOf(id: string): string | null {
    const row = this.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(id) as { password_hash: string } | undefined;
    return row?.password_hash ?? null;
  }

  setPasswordHash(id: string, passwordHash: string): void {
    this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
  }

  /** Nome, nome de entrada e senha de um convidado, juntos (criar senha ou link de retorno). */
  setGuestCredentials(id: string, name: string, credentials: GuestCredentials): void {
    this.db
      .prepare("UPDATE users SET name = ?, login_name = ?, password_hash = ? WHERE id = ? AND kind = 'guest'")
      .run(name, credentials.loginName, credentials.passwordHash, id);
  }

  /** Renomeia um convidado com senha: o nome de entrada acompanha. */
  renameGuestLogin(id: string, name: string, loginName: string): void {
    this.db.prepare("UPDATE users SET name = ?, login_name = ? WHERE id = ? AND kind = 'guest'").run(name, loginName, id);
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
  return {
    id: row.id,
    name: row.name,
    email: row.email.startsWith(GUEST_EMAIL_PREFIX) ? '' : row.email,
    kind: row.kind,
    createdAt: row.created_at,
    hasPassword: row.password_hash !== NO_PASSWORD,
  };
}
