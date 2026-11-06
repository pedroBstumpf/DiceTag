import { chmodSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Db } from '../db/database';
import { MIGRATIONS } from '../db/migrations';

/**
 * Backup e conferência da restauração (BACKEND_SECURITY.md §15).
 *
 * `createBackup` grava em `<raiz>/<data e hora>/` uma cópia consistente do banco (`VACUUM INTO`,
 * segura com o servidor no ar, mesmo em WAL) e a pasta de arquivos enviados. `checkBackup` abre a
 * cópia como se fosse restaurá-la e confere integridade, chaves estrangeiras, migrações e se todo
 * arquivo registrado está lá. Cifrar e levar a cópia para fora do servidor é feito pela ferramenta
 * de backup da hospedagem (ver OPERATIONS.md).
 */

export const BACKUP_DB = 'zehenia.db';
export const BACKUP_FILES = 'files';

/** Faz o backup e devolve a pasta criada (só legível pelo usuário do processo). */
export async function createBackup(db: Db, filesDir: string, root: string, now = new Date()): Promise<string> {
  const dir = join(root, now.toISOString().replace(/[:.]/g, '-'));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  db.prepare('VACUUM INTO ?').run(join(dir, BACKUP_DB));
  // Arquivos têm id único e nunca mudam: copiar com o servidor no ar é seguro (temporários ficam de fora)
  if (existsSync(filesDir)) await cp(filesDir, join(dir, BACKUP_FILES), { recursive: true, filter: (src) => !src.endsWith('.part') });
  else mkdirSync(join(dir, BACKUP_FILES));
  try {
    chmodSync(join(dir, BACKUP_DB), 0o600);
  } catch {
    // Sem permissões POSIX (Windows): valem as da pasta
  }
  return dir;
}

export interface BackupReport {
  ok: boolean;
  problems: string[];
  counts: Record<'users' | 'worlds' | 'tables' | 'files', number>;
}

/**
 * Abre a cópia como numa restauração e confere se ela está inteira e utilizável. `filesDir`: onde
 * estão os arquivos enviados (padrão: a pasta `files` da cópia).
 */
export function checkBackup(dir: string, filesDir = join(dir, BACKUP_FILES)): BackupReport {
  const problems: string[] = [];
  const path = join(dir, BACKUP_DB);
  if (!existsSync(path)) return { ok: false, problems: [`banco não encontrado em ${path}`], counts: { users: 0, worlds: 0, tables: 0, files: 0 } };
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const integrity = (db.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[]).map((r) => r.integrity_check);
    if (integrity.join() !== 'ok') problems.push(`integridade: ${integrity.join('; ')}`);
    const brokenKeys = db.prepare('PRAGMA foreign_key_check').all();
    if (brokenKeys.length) problems.push(`${brokenKeys.length} referência(s) quebrada(s) entre tabelas`);
    const migrations = Number((db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n);
    if (migrations > MIGRATIONS.length) problems.push(`banco de uma versão mais nova do servidor (${migrations} migrações)`);

    const stored = new Set(existsSync(filesDir) ? readdirSync(filesDir) : []);
    const missing = (db.prepare('SELECT id FROM files').all() as { id: string }[]).filter((f) => !stored.has(f.id));
    if (missing.length) problems.push(`${missing.length} arquivo(s) registrado(s) sem o conteúdo na cópia`);

    const count = (table: string) => Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
    // Nomes de tabela de uma lista fixa (não aceitam parâmetro)
    const counts = { users: count('users'), worlds: count('worlds'), tables: count('game_tables'), files: count('files') };
    return { ok: !problems.length, problems, counts };
  } finally {
    db.close();
  }
}
