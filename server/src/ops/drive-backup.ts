import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, open, readdir, rename, rm, rmdir, stat, utimes, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { DatabaseSync } from 'node:sqlite';
import { BACKUP_DB, BACKUP_FILES, checkBackup, type BackupReport } from './backup';

/**
 * Backup numa pasta sincronizada com a nuvem (Google Drive para computador), feito pelo
 * `npm run mesa` (BACKEND_SECURITY.md §15):
 *
 * - `banco/<data e hora>.db.zhb`: cópia consistente do banco (`VACUUM INTO`), conferida e CIFRADA;
 *   ficam as `keep` mais novas;
 * - `arquivos-da-mesa/<id>.zhb`: cada arquivo enviado à mesa, CIFRADO; só os novos (nunca mudam);
 * - `biblioteca/`: espelho LEGÍVEL da biblioteca do dono (são só os arquivos dele, sem dados de
 *   jogadores); o que sai da biblioteca sai do espelho (a lixeira do Drive guarda 30 dias).
 *
 * A chave (`BACKUP_KEY`) fica só no `segredos.env`, que NÃO vai para a nuvem: os segredos têm cópia
 * separada do banco. Cifra: AES-256-GCM, formato `ZHB1 | iv (12) | dados | etiqueta (16)`.
 */

// --- Cifra ---------------------------------------------------------------------------

const MAGIC = Buffer.from('ZHB1');
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + IV_BYTES;
/** Extensão dos arquivos cifrados. */
export const SEALED = '.zhb';

/** Cifra `src` em `dest` (gravado num temporário e renomeado: nunca fica um arquivo pela metade). */
export async function encryptFile(src: string, dest: string, key: Buffer): Promise<void> {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const tmp = `${dest}.tmp`;
  try {
    await pipeline(
      createReadStream(src),
      async function* (source: AsyncIterable<Buffer>) {
        yield Buffer.concat([MAGIC, iv]);
        for await (const chunk of source) yield cipher.update(chunk);
        yield cipher.final();
        yield cipher.getAuthTag();
      },
      createWriteStream(tmp),
    );
    await rename(tmp, dest);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/** Decifra `src` em `dest`. Chave errada ou arquivo alterado: erro, e nenhum arquivo é gravado. */
export async function decryptFile(src: string, dest: string, key: Buffer): Promise<void> {
  const { size } = await stat(src);
  if (size < HEADER_BYTES + TAG_BYTES) throw new Error(`${src}: não é um backup do app.`);
  const header = Buffer.alloc(HEADER_BYTES);
  const tag = Buffer.alloc(TAG_BYTES);
  const handle = await open(src, 'r');
  try {
    await handle.read(header, 0, HEADER_BYTES, 0);
    await handle.read(tag, 0, TAG_BYTES, size - TAG_BYTES);
  } finally {
    await handle.close();
  }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error(`${src}: não é um backup do app.`);
  const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(MAGIC.length));
  decipher.setAuthTag(tag);
  const body = size > HEADER_BYTES + TAG_BYTES ? createReadStream(src, { start: HEADER_BYTES, end: size - TAG_BYTES - 1 }) : Readable.from([]);
  const tmp = `${dest}.tmp`;
  try {
    await pipeline(body, decipher, createWriteStream(tmp));
    await rename(tmp, dest);
  } catch {
    await rm(tmp, { force: true });
    throw new Error(`${src}: não foi possível decifrar (chave errada ou arquivo alterado).`);
  }
}

// --- Espelho da biblioteca ---------------------------------------------------------------

export interface FileStamp {
  size: number;
  mtimeMs: number;
}

/** Diferença de horário tolerada (sistemas de arquivos e o Drive arredondam). */
const MTIME_TOLERANCE_MS = 2000;
/** Arquivos do sistema e temporários: ficam fora do espelho (nos dois lados). */
const IGNORED = /^(desktop\.ini|thumbs\.db|\..*|~\$.*|.*\.tmp)$/i;

/** O que copiar (falta ou mudou) e o que remover (saiu da origem) para o destino ficar igual. */
export function planMirror(source: ReadonlyMap<string, FileStamp>, dest: ReadonlyMap<string, FileStamp>): { copy: string[]; remove: string[] } {
  const copy: string[] = [];
  for (const [path, s] of source) {
    const d = dest.get(path);
    if (!d || d.size !== s.size || Math.abs(s.mtimeMs - d.mtimeMs) > MTIME_TOLERANCE_MS) copy.push(path);
  }
  const remove = [...dest.keys()].filter((path) => !source.has(path));
  return { copy, remove };
}

/** Arquivos comuns de uma pasta, por caminho relativo com `/` (atalhos não são seguidos). */
async function listTree(root: string): Promise<Map<string, FileStamp>> {
  const files = new Map<string, FileStamp>();
  if (!existsSync(root)) return files;
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      if (IGNORED.test(item.name)) continue;
      const path = join(dir, item.name);
      if (item.isDirectory()) await walk(path, `${prefix}${item.name}/`);
      else if (item.isFile()) {
        const { size, mtimeMs } = await stat(path);
        files.set(`${prefix}${item.name}`, { size, mtimeMs });
      }
    }
  };
  await walk(root, '');
  return files;
}

/** Deixa `dest` igual a `source`. Devolve quantos arquivos foram copiados e removidos. */
async function mirror(source: string, dest: string): Promise<{ copied: number; removed: number }> {
  const sourceFiles = await listTree(source);
  const plan = planMirror(sourceFiles, await listTree(dest));
  for (const path of plan.copy) {
    const to = join(dest, ...path.split('/'));
    const from = join(source, ...path.split('/'));
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, `${to}.tmp`);
    await rename(`${to}.tmp`, to);
    const { mtime } = await stat(from);
    // Mesmo horário da origem: na próxima vez, o arquivo conta como igual
    await utimes(to, mtime, mtime);
  }
  for (const path of plan.remove) {
    const file = join(dest, ...path.split('/'));
    await rm(file, { force: true });
    // Pastas que ficaram vazias saem também (até a raiz do espelho)
    for (let folder = dirname(file); folder.length > dest.length; folder = dirname(folder)) {
      if ((await readdir(folder)).length) break;
      await rmdir(folder);
    }
  }
  return { copied: plan.copy.length, removed: plan.remove.length };
}

// --- Rodízio e pasta do Drive ----------------------------------------------------------------

const DB_COPY = '.db' + SEALED;

/** Cópias do banco que passaram do limite (os nomes começam pela data, então a ordem é a do nome). */
export function expiredCopies(names: readonly string[], keep: number): string[] {
  return names
    .filter((n) => n.endsWith(DB_COPY))
    .sort()
    .reverse()
    .slice(keep);
}

/** Onde o Google Drive para computador costuma montar o "Meu Drive" (unidade virtual ou pasta espelhada). */
export function driveCandidates(home = homedir()): string[] {
  const names = ['Meu Drive', 'My Drive'];
  const letters = 'DEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  return [...letters.flatMap((l) => names.map((n) => `${l}:\\${n}`)), ...names.map((n) => join(home, n))];
}

/** Primeira pasta do "Meu Drive" que existe nesta máquina (null = Drive para computador não instalado). */
export function findDriveFolder(exists: (path: string) => boolean, candidates = driveCandidates()): string | null {
  return candidates.find((path) => exists(path)) ?? null;
}

// --- Backup e restauração --------------------------------------------------------------------

export const DRIVE_DIRS = { database: 'banco', files: 'arquivos-da-mesa', library: 'biblioteca' } as const;

export interface DriveBackupOptions {
  /** Conexão (pode ser só leitura) com o banco do app. */
  db: DatabaseSync;
  filesDir: string;
  libraryDir: string;
  /** Pasta do backup dentro do Drive. */
  target: string;
  /** Chave AES-256 (32 bytes) do `segredos.env`. */
  key: Buffer;
  now?: Date;
  /** Cópias do banco mantidas. */
  keep?: number;
  /** Só o banco (rápido: ao fechar a mesa). */
  databaseOnly?: boolean;
}

export interface DriveBackupReport {
  /** Cópia do banco gravada. */
  database: string;
  /** Conferência da cópia, feita antes de cifrar. */
  check: BackupReport;
  filesAdded: number;
  library: { copied: number; removed: number };
}

const README = `Backup do Crônicas de Zehenia
=============================

banco/             cópias do banco de dados, CIFRADAS (as mais novas ficam; as antigas saem sozinhas)
arquivos-da-mesa/  mapas, tokens, sons e imagens enviados às mesas, CIFRADOS
biblioteca/        a sua biblioteca de imagens e sons, como está no computador

A chave fica no arquivo segredos.env da pasta do app, que NÃO vem para cá. Guarde uma cópia dele
fora da nuvem (pendrive, gerenciador de senhas): sem ele, o banco e os arquivos não podem ser lidos.

Para restaurar: na pasta server do projeto, rode  npm run restaurar
`;

/** Faz o backup na pasta do Drive. Cópia do banco com problema: gravada, mas sem apagar as antigas. */
export async function runDriveBackup(options: DriveBackupOptions): Promise<DriveBackupReport> {
  const { db, filesDir, libraryDir, target, key, now = new Date(), keep = 14, databaseOnly = false } = options;
  const databaseDir = join(target, DRIVE_DIRS.database);
  await mkdir(databaseDir, { recursive: true });
  if (!existsSync(join(target, 'LEIA-ME.txt'))) await writeFile(join(target, 'LEIA-ME.txt'), README);

  // 1. Banco: cópia consistente num temporário local (nunca vai sem cifra para a nuvem), conferida
  const work = await mkdtemp(join(tmpdir(), 'zehenia-backup-'));
  let database: string;
  let check: BackupReport;
  try {
    db.prepare('VACUUM INTO ?').run(join(work, BACKUP_DB));
    check = checkBackup(work, filesDir);
    database = join(databaseDir, `${now.toISOString().replace(/[:.]/g, '-')}${DB_COPY}`);
    await encryptFile(join(work, BACKUP_DB), database, key);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  if (check.ok) for (const name of expiredCopies(await readdir(databaseDir), keep)) await rm(join(databaseDir, name), { force: true });
  if (databaseOnly) return { database, check, filesAdded: 0, library: { copied: 0, removed: 0 } };

  // 2. Arquivos da mesa: id único e conteúdo que nunca muda, então só os que faltam
  const sealedDir = join(target, DRIVE_DIRS.files);
  await mkdir(sealedDir, { recursive: true });
  const sealed = new Set(await readdir(sealedDir));
  let filesAdded = 0;
  for (const item of existsSync(filesDir) ? await readdir(filesDir, { withFileTypes: true }) : []) {
    if (!item.isFile() || item.name.endsWith('.part') || sealed.has(item.name + SEALED)) continue;
    await encryptFile(join(filesDir, item.name), join(sealedDir, item.name + SEALED), key);
    filesAdded++;
  }

  // 3. Biblioteca: espelho legível
  const library = await mirror(libraryDir, join(target, DRIVE_DIRS.library));
  return { database, check, filesAdded, library };
}

export interface RestoreOptions {
  target: string;
  /** Pasta nova (ou vazia) onde a cópia é montada. */
  out: string;
  key: Buffer;
  /** Nome da cópia do banco em `banco/` (padrão: a mais nova). */
  database?: string;
}

/**
 * Monta em `out` uma cópia pronta para restaurar (`zehenia.db` + `files/`), como a do
 * `npm run backup`, e a confere (`checkBackup`). Não mexe na pasta do app.
 */
export async function restoreDriveBackup({ target, out, key, database }: RestoreOptions): Promise<{ dir: string; database: string; report: BackupReport }> {
  const databaseDir = join(target, DRIVE_DIRS.database);
  const copies = existsSync(databaseDir) ? (await readdir(databaseDir)).filter((n) => n.endsWith(DB_COPY)).sort() : [];
  const chosen = database ?? copies[copies.length - 1];
  if (!chosen || !copies.includes(chosen)) throw new Error(database ? `Cópia ${database} não encontrada em ${databaseDir}.` : `Nenhuma cópia do banco em ${databaseDir}.`);
  if (existsSync(out) && (await readdir(out)).length) throw new Error(`A pasta ${out} já tem arquivos: escolha uma pasta nova.`);

  await mkdir(join(out, BACKUP_FILES), { recursive: true });
  await decryptFile(join(databaseDir, chosen), join(out, BACKUP_DB), key);
  const sealedDir = join(target, DRIVE_DIRS.files);
  for (const name of existsSync(sealedDir) ? await readdir(sealedDir) : []) {
    if (name.endsWith(SEALED)) await decryptFile(join(sealedDir, name), join(out, BACKUP_FILES, name.slice(0, -SEALED.length)), key);
  }
  return { dir: out, database: chosen, report: checkBackup(out) };
}
