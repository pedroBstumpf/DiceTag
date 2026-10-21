import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../src/config/env';
import { checkBackup, createBackup } from '../src/ops/backup';

/**
 * `npm run backup [-- <pasta>]`: cópia consistente do banco e dos arquivos enviados, segura com
 * o servidor no ar. Padrão: `<pasta do banco>/backups/<data e hora>/`. Ao terminar, confere a
 * cópia como numa restauração (`checkBackup`) e mostra o resultado.
 *
 * Cifrar e mandar a cópia para fora do servidor é o passo seguinte (ver OPERATIONS.md).
 */
if (existsSync('.env')) process.loadEnvFile('.env');
const config = loadConfig();
const root = resolve(process.argv[2] ?? join(dirname(config.DATABASE_PATH), 'backups'));

const db = new DatabaseSync(config.DATABASE_PATH, { readOnly: true });
try {
  const dir = await createBackup(db, config.FILES_DIR, root);
  const report = checkBackup(dir);
  console.log(`Backup em ${dir}`);
  console.log(`Contas: ${report.counts.users} · mundos: ${report.counts.worlds} · mesas: ${report.counts.tables} · arquivos: ${report.counts.files}`);
  if (!report.ok) {
    console.error(`A cópia tem problemas:\n  - ${report.problems.join('\n  - ')}`);
    process.exitCode = 1;
  }
} finally {
  db.close();
}
