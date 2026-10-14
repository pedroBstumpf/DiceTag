import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { MIGRATIONS } from './migrations';

/**
 * Banco SQLite (módulo `node:sqlite`, embutido no Node: sem pacote nativo).
 *
 * Segurança:
 * - toda consulta usa parâmetros (`?`), nunca texto concatenado: sem injeção de SQL;
 * - extensões desabilitadas (`allowExtension: false`, padrão) e `trusted_schema = OFF`;
 * - `secure_delete` sobrescreve com zeros o que é apagado (hashes de senha, sessões);
 * - chaves estrangeiras ligadas (apagar uma mesa apaga membros, convites e estado).
 *
 * O acesso fica nos repositórios (`src/repositories`): trocar por PostgreSQL depois é só
 * reescrever essa camada.
 */

export type Db = DatabaseSync;
export type Row = Record<string, SQLInputValue>;

/** Abre (ou cria) o banco, aplica as configurações de segurança e as migrações pendentes. */
export function openDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true, allowExtension: false });
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA trusted_schema = OFF;
    PRAGMA secure_delete = ON;
    PRAGMA foreign_keys = ON;
  `);
  migrate(db);
  return db;
}

/** Aplica, em ordem e numa transação cada, as migrações ainda não aplicadas (`user_version`). */
function migrate(db: Db): void {
  const current = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  MIGRATIONS.slice(current).forEach((sql, i) => {
    transaction(db, () => {
      db.exec(sql);
      // PRAGMA não aceita parâmetro; o valor é um inteiro gerado aqui, não entrada externa
      db.exec(`PRAGMA user_version = ${current + i + 1}`);
    });
  });
}

/** Executa `fn` numa transação: tudo ou nada. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
