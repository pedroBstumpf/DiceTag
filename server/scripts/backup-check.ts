import { resolve } from 'node:path';
import { checkBackup } from '../src/ops/backup';

/**
 * `npm run backup:check -- <pasta do backup>`: teste de restauração. Abre a cópia como se fosse
 * restaurá-la e confere integridade, chaves estrangeiras, migrações e arquivos. Rode depois de
 * trazer de volta (e decifrar) um backup guardado fora do servidor: backup nunca restaurado não é
 * garantia (BACKEND_SECURITY.md §15).
 */
const dir = process.argv[2];
if (!dir) {
  console.error('Informe a pasta do backup: npm run backup:check -- <pasta>');
  process.exit(1);
}

const report = checkBackup(resolve(dir));
console.log(`Contas: ${report.counts.users} · mundos: ${report.counts.worlds} · mesas: ${report.counts.tables} · arquivos: ${report.counts.files}`);
if (report.ok) {
  console.log('Backup íntegro: pode ser restaurado.');
} else {
  console.error(`Backup com problemas:\n  - ${report.problems.join('\n  - ')}`);
  process.exitCode = 1;
}
