import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { findDriveFolder, runDriveBackup, type DriveBackupReport } from '../../src/ops/drive-backup';
import { backupKey, databasePath, libraryDir, secretsFile, tableFilesDir } from './app-env';

/**
 * Backup automático no Google Drive para o `npm run mesa` (e `npm run backup-drive`).
 *
 * Destino: `ZEHENIA_BACKUP_DIR`, ou `<Meu Drive>\Cronicas de Zehenia - backup` quando o Google Drive
 * para computador está instalado. Roda neste processo (o servidor isolado não grava fora da pasta
 * do app nem conhece a chave). Erros viram aviso no terminal: a mesa nunca cai por causa do backup.
 */

const FOLDER = 'Cronicas de Zehenia - backup';
/** Intervalo entre backups completos com a mesa aberta. */
export const BACKUP_EVERY_MS = 60 * 60 * 1000;

/** Pasta do backup (null = sem Google Drive e sem `ZEHENIA_BACKUP_DIR`). */
export function backupTarget(): string | null {
  const custom = process.env['ZEHENIA_BACKUP_DIR'];
  if (custom) return resolve(custom);
  const drive = findDriveFolder(existsSync);
  return drive ? join(drive, FOLDER) : null;
}

/** Faz um backup agora (completo, ou só o banco) e devolve o relatório. */
export async function backupNow(target: string, databaseOnly = false): Promise<DriveBackupReport> {
  const key = backupKey();
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return await runDriveBackup({ db, filesDir: tableFilesDir, libraryDir, target, key, databaseOnly });
  } finally {
    db.close();
  }
}

/** Uma linha para o terminal. */
export function describeBackup(report: DriveBackupReport, databaseOnly = false): string {
  const database = report.check.ok ? 'banco ok' : `banco com problemas (${report.check.problems.join('; ')})`;
  if (databaseOnly) return `Backup no Drive: ${database}.`;
  const { copied, removed } = report.library;
  return `Backup no Drive: ${database} · ${report.filesAdded} arquivo(s) da mesa novo(s) · biblioteca +${copied} −${removed}.`;
}

/** Backups da sessão: ao iniciar, a cada hora e (só o banco) ao fechar. Um de cada vez. */
export class DriveBackups {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(private readonly target: string) {}

  start(): void {
    console.log(`  Backup no Google Drive: ${this.target}`);
    console.log(`  Guarde uma cópia de ${secretsFile} FORA da nuvem: sem ela, o backup não pode ser lido.\n`);
    this.run(false);
    this.timer = setInterval(() => this.run(false), BACKUP_EVERY_MS);
    this.timer.unref();
  }

  /** Ao fechar a mesa: só o banco, rápido, com prazo (o Windows encerra a janela em poucos segundos). */
  async finish(deadlineMs = 4000): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    const last = backupNow(this.target, true).then(
      (report) => console.log(`  ${describeBackup(report, true)}`),
      (err: unknown) => console.error(`  Backup no Drive falhou: ${err instanceof Error ? err.message : err}`),
    );
    await Promise.race([last, new Promise((done) => setTimeout(done, deadlineMs))]);
  }

  private run(databaseOnly: boolean): void {
    if (this.running) return;
    this.running = backupNow(this.target, databaseOnly)
      .then(
        (report) => console.log(`  ${describeBackup(report, databaseOnly)}`),
        (err: unknown) => console.error(`  Backup no Drive falhou: ${err instanceof Error ? err.message : err}`),
      )
      .finally(() => {
        this.running = null;
      });
  }
}
