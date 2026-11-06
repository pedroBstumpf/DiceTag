import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { restoreDriveBackup } from '../src/ops/drive-backup';
import { backupKey, databasePath, home, tableFilesDir } from './lib/app-env';
import { backupTarget } from './lib/drive-backup';

/**
 * `npm run restaurar`: decifra um backup do Google Drive numa pasta nova e confere se ele está
 * inteiro (como numa restauração de verdade). Não mexe na pasta do app: os passos para colocar a
 * cópia em uso aparecem no fim. Serve também para testar o backup de vez em quando.
 *
 *   npm run restaurar                          # a cópia mais nova do banco
 *   npm run restaurar -- --banco <nome>.db.zhb # uma cópia específica (pasta banco/ do backup)
 *   npm run restaurar -- --de <pasta>          # backup em outro lugar (ex.: outro computador)
 *   npm run restaurar -- --para <pasta>        # onde montar a cópia
 *
 * Precisa do segredos.env (com a BACKUP_KEY) na pasta do app.
 */
const { values } = parseArgs({ options: { banco: { type: 'string' }, de: { type: 'string' }, para: { type: 'string' } } });
const target = values.de ? resolve(values.de) : backupTarget();
if (!target) {
  console.error('Backup não encontrado: instale o Google Drive para computador ou use --de <pasta do backup>.');
  process.exit(1);
}
const out = resolve(values.para ?? join(home, 'restauracoes', new Date().toISOString().replace(/[:.]/g, '-')));

const { dir, database, report } = await restoreDriveBackup({ target, out, key: backupKey(false), database: values.banco });
console.log(`Cópia ${database} montada em ${dir}`);
console.log(`Contas: ${report.counts.users} · mundos: ${report.counts.worlds} · mesas: ${report.counts.tables} · arquivos: ${report.counts.files}`);
if (!report.ok) {
  console.error(`A cópia tem problemas:\n  - ${report.problems.join('\n  - ')}`);
  process.exit(1);
}
console.log(`
A cópia está inteira. Para colocá-la em uso:
  1. Feche a mesa (a janela do Iniciar mesa).
  2. Guarde o banco atual, renomeando ${databasePath} (e os arquivos -wal e -shm, se houver).
  3. Copie ${join(dir, 'zehenia.db')} para ${databasePath}.
  4. Copie o conteúdo de ${join(dir, 'files')} para ${tableFilesDir}.
  5. Inicie a mesa de novo.
`);
