import { home } from './lib/app-env';
import { backupNow, backupTarget, describeBackup } from './lib/drive-backup';

/**
 * `npm run backup-drive`: faz agora o backup da pasta do app no Google Drive (o mesmo que o
 * `npm run mesa` faz ao abrir, a cada hora e ao fechar). Destino: `ZEHENIA_BACKUP_DIR` ou o
 * "Meu Drive" do Google Drive para computador. Pode rodar com a mesa aberta.
 */
const target = backupTarget();
if (!target) {
  console.error('Google Drive para computador não encontrado. Instale-o ou defina ZEHENIA_BACKUP_DIR com a pasta do backup.');
  process.exit(1);
}
console.log(`Pasta do app: ${home}\nBackup em:    ${target}\n`);
const report = await backupNow(target);
console.log(describeBackup(report));
if (!report.check.ok) process.exitCode = 1;
