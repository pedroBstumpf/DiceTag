import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { MIGRATIONS } from './migrations';

/**
 * Banco SQLite (módulo `node:sqlite`, embutido no Node: sem pacote nativo).
 *
 * Segurança (BACKEND_SECURITY.md §6):
 * - toda consulta usa parâmetros (`?`), nunca texto concatenado: sem injeção de SQL;
 * - extensões desabilitadas (`allowExtension: false`, padrão) e `trusted_schema = OFF`;
 * - `secure_delete` sobrescreve com zeros o que é apagado (hashes de senha, sessões);
 * - chaves estrangeiras ligadas (apagar uma mesa apaga membros, convites e estado);
 * - pasta do banco só do usuário do processo (700) e arquivo do banco 600;
 * - migrações registradas em `schema_migrations`, cada uma numa transação, com um backup
 *   (`VACUUM INTO`) do banco antes de aplicar as pendentes.
 *
 * O acesso fica nos repositórios (`src/repositories`): trocar por PostgreSQL depois é só
 * reescrever essa camada.
 */

export type Db = DatabaseSync;
export type Row = Record<string, SQLInputValue>;

/** Abre (ou cria) o banco, aplica as configurações de segurança e as migrações pendentes. */
export function openDatabase(path: string): Db {
  const onDisk = path !== ':memory:';
  if (onDisk) mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true, allowExtension: false });
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA trusted_schema = OFF;
    PRAGMA secure_delete = ON;
    PRAGMA foreign_keys = ON;
  `);
  if (onDisk) restrictToOwner(path);
  migrate(db, onDisk ? path : null);
  return db;
}

/** Só o usuário do processo lê e grava o banco e os arquivos do WAL (no Windows, valem as permissões da pasta). */
function restrictToOwner(path: string): void {
  for (const file of [path, `${path}-wal`, `${path}-shm`]) {
    try {
      if (existsSync(file)) chmodSync(file, 0o600);
    } catch {
      // Sistema de arquivos sem permissões POSIX: segue com as da pasta
    }
  }
}

/**
 * Aplica, em ordem e numa transação cada, as migrações ainda não registradas em
 * `schema_migrations` (só para frente: nunca edite uma já publicada, crie outra).
 * Com o banco em disco e já em uso, faz antes um backup consistente (`VACUUM INTO`) em
 * `<pasta do banco>/backups/`. Bancos da versão anterior (contagem em `user_version`) são adotados.
 */
export function migrate(db: Db, path: string | null, migrations: readonly string[] = MIGRATIONS): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL) STRICT');
  adoptLegacyVersion(db);
  const applied = new Set((db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version));
  const pending = migrations.map((sql, i) => ({ version: i + 1, sql })).filter((m) => !applied.has(m.version));
  if (!pending.length) return;
  if (path && applied.size) backupBeforeMigrating(db, path, pending[0].version);
  for (const migration of pending) {
    transaction(db, () => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(migration.version, Date.now());
    });
  }
}

/** Banco criado antes de `schema_migrations`: registra as migrações que `user_version` contava. */
function adoptLegacyVersion(db: Db): void {
  const registered = Number((db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n);
  const legacy = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  if (registered || !legacy) return;
  const insert = db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)');
  transaction(db, () => {
    for (let version = 1; version <= legacy; version++) insert.run(version, Date.now());
  });
}

/** Cópia consistente do banco (mesmo em WAL) antes de migrar, só legível pelo usuário do processo. */
function backupBeforeMigrating(db: Db, path: string, nextVersion: number): void {
  const dir = join(dirname(path), 'backups');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = join(dir, `${basename(path, '.db')}-${stamp}-antes-v${nextVersion}.db`);
  db.prepare('VACUUM INTO ?').run(target);
  restrictToOwner(target);
}

/** Transações abertas por banco: dentro de outra, uma transação vira SAVEPOINT. */
const depth = new WeakMap<Db, number>();

/**
 * Executa `fn` numa transação: tudo ou nada. Pode ser aninhada (um repositório que grava em
 * várias tabelas dentro de um serviço que já abriu a sua): a interna vira SAVEPOINT.
 */
export function transaction<T>(db: Db, fn: () => T): T {
  const level = depth.get(db) ?? 0;
  // Nome gerado aqui (contador interno), nunca entrada externa
  const savepoint = `sp${level}`;
  db.exec(level === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`);
  depth.set(db, level + 1);
  try {
    const result = fn();
    db.exec(level === 0 ? 'COMMIT' : `RELEASE ${savepoint}`);
    return result;
  } catch (err) {
    db.exec(level === 0 ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
    throw err;
  } finally {
    depth.set(db, level);
  }
}
