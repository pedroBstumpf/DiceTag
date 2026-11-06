import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/database';
import {
  decryptFile,
  encryptFile,
  expiredCopies,
  findDriveFolder,
  planMirror,
  restoreDriveBackup,
  runDriveBackup,
} from '../src/ops/drive-backup';

/**
 * Backup no Google Drive (pasta sincronizada): banco e arquivos da mesa cifrados, biblioteca como
 * espelho legível, rodízio das cópias do banco e restauração conferida.
 */

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zehenia-drive-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const key = randomBytes(32);

describe('cifra dos arquivos', () => {
  it('cifra e decifra de volta igual, sem o conteúdo legível no arquivo cifrado', async () => {
    const plain = join(dir, 'mapa.png');
    writeFileSync(plain, 'conteúdo secreto do mapa'.repeat(1000));
    await encryptFile(plain, join(dir, 'mapa.zhb'), key);
    expect(readFileSync(join(dir, 'mapa.zhb')).includes('secreto')).toBe(false);

    await decryptFile(join(dir, 'mapa.zhb'), join(dir, 'volta.png'), key);
    expect(readFileSync(join(dir, 'volta.png'))).toEqual(readFileSync(plain));
  });

  it('arquivo adulterado ou chave errada: recusa e não deixa arquivo decifrado', async () => {
    writeFileSync(join(dir, 'a'), 'dados');
    await encryptFile(join(dir, 'a'), join(dir, 'a.zhb'), key);
    const tampered = readFileSync(join(dir, 'a.zhb'));
    tampered[tampered.length - 20] ^= 1;
    writeFileSync(join(dir, 'b.zhb'), tampered);

    await expect(decryptFile(join(dir, 'b.zhb'), join(dir, 'b'), key)).rejects.toThrow();
    await expect(decryptFile(join(dir, 'a.zhb'), join(dir, 'c'), randomBytes(32))).rejects.toThrow();
    expect(existsSync(join(dir, 'b'))).toBe(false);
    expect(existsSync(join(dir, 'c'))).toBe(false);
  });
});

describe('espelho da biblioteca', () => {
  const stamp = (size: number, mtimeMs: number) => ({ size, mtimeMs });

  it('copia o que falta ou mudou e remove o que saiu da origem', () => {
    const source = new Map([
      ['imagens/novo.png', stamp(10, 1000)],
      ['imagens/igual.png', stamp(10, 1000)],
      ['sons/maior.mp3', stamp(20, 1000)],
      ['sons/editado.mp3', stamp(5, 90_000)],
    ]);
    const dest = new Map([
      ['imagens/igual.png', stamp(10, 1000)],
      ['sons/maior.mp3', stamp(15, 1000)],
      ['sons/editado.mp3', stamp(5, 1000)],
      ['imagens/apagado.png', stamp(1, 1000)],
    ]);
    const plan = planMirror(source, dest);
    expect(plan.copy.sort()).toEqual(['imagens/novo.png', 'sons/editado.mp3', 'sons/maior.mp3']);
    expect(plan.remove).toEqual(['imagens/apagado.png']);
  });

  it('diferença pequena no horário (o Drive arredonda) não recopia', () => {
    const plan = planMirror(new Map([['a.png', stamp(1, 10_000)]]), new Map([['a.png', stamp(1, 11_500)]]));
    expect(plan).toEqual({ copy: [], remove: [] });
  });
});

describe('rodízio das cópias do banco', () => {
  it('mantém as mais novas e devolve as que passaram do limite', () => {
    const names = ['2026-01-03.db.zhb', '2026-01-01.db.zhb', '2026-01-02.db.zhb', 'LEIA-ME.txt'];
    expect(expiredCopies(names, 2)).toEqual(['2026-01-01.db.zhb']);
    expect(expiredCopies(names, 5)).toEqual([]);
  });
});

describe('pasta do Google Drive', () => {
  it('acha o "Meu Drive" (ou "My Drive") em qualquer letra de unidade', () => {
    const existing = new Set(['I:\\Meu Drive']);
    expect(findDriveFolder((p) => existing.has(p))).toBe('I:\\Meu Drive');
    expect(findDriveFolder((p) => p === 'G:\\My Drive')).toBe('G:\\My Drive');
    expect(findDriveFolder(() => false)).toBeNull();
  });
});

describe('backup completo e restauração', () => {
  /** Pasta do app de mentira: banco com um arquivo registrado, arquivos da mesa e biblioteca. */
  function fakeApp() {
    const db = openDatabase(join(dir, 'zehenia.db'));
    db.prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES ('u', 'a@b.co', 'A', 'h', 0)").run();
    db.prepare("INSERT INTO files (id, owner_id, mime, size, sha256, created_at) VALUES ('f1', 'u', 'image/png', 3, 'x', 0)").run();
    const filesDir = join(dir, 'arquivos');
    mkdirSync(filesDir);
    writeFileSync(join(filesDir, 'f1'), 'png');
    writeFileSync(join(filesDir, 'f2.part'), 'envio interrompido');
    const libraryDir = join(dir, 'biblioteca');
    mkdirSync(join(libraryDir, 'imagens', 'mapas'), { recursive: true });
    writeFileSync(join(libraryDir, 'imagens', 'mapas', 'taverna.jpg'), 'taverna');
    const target = join(dir, 'drive');
    return { db, filesDir, libraryDir, target };
  }

  it('grava banco e arquivos cifrados, espelha a biblioteca e a restauração passa na conferência', async () => {
    const { db, filesDir, libraryDir, target } = fakeApp();
    const reading = new DatabaseSync(join(dir, 'zehenia.db'), { readOnly: true });

    const report = await runDriveBackup({ db: reading, filesDir, libraryDir, target, key, now: new Date('2026-11-06T10:00:00Z') });
    expect(report.check.ok).toBe(true);
    expect(report.filesAdded).toBe(1);
    expect(report.library).toEqual({ copied: 1, removed: 0 });
    expect(readdirSync(join(target, 'banco')).filter((n) => n.endsWith('.zhb'))).toHaveLength(1);
    expect(readdirSync(join(target, 'arquivos-da-mesa'))).toEqual(['f1.zhb']);
    expect(readFileSync(join(target, 'biblioteca', 'imagens', 'mapas', 'taverna.jpg'), 'utf8')).toBe('taverna');
    expect(existsSync(join(target, 'LEIA-ME.txt'))).toBe(true);

    // Segunda vez: nada novo para copiar; biblioteca apagada some do espelho
    rmSync(join(libraryDir, 'imagens', 'mapas', 'taverna.jpg'));
    const again = await runDriveBackup({ db: reading, filesDir, libraryDir, target, key, now: new Date('2026-11-06T11:00:00Z') });
    expect(again.filesAdded).toBe(0);
    expect(again.library).toEqual({ copied: 0, removed: 1 });

    const restored = await restoreDriveBackup({ target, out: join(dir, 'restaurado'), key });
    expect(restored.report).toMatchObject({ ok: true, counts: { users: 1, files: 1 } });
    expect(readFileSync(join(restored.dir, 'files', 'f1'), 'utf8')).toBe('png');
    reading.close();
    db.close();
  });

  it('só o banco (ao fechar a mesa): não mexe em arquivos nem na biblioteca, e respeita o rodízio', async () => {
    const { db, filesDir, libraryDir, target } = fakeApp();
    const reading = new DatabaseSync(join(dir, 'zehenia.db'), { readOnly: true });
    for (let hour = 0; hour < 4; hour++) {
      const now = new Date(Date.UTC(2026, 10, 6, hour));
      await runDriveBackup({ db: reading, filesDir, libraryDir, target, key, now, keep: 2, databaseOnly: true });
    }
    const copies = readdirSync(join(target, 'banco')).filter((n) => n.endsWith('.zhb'));
    expect(copies).toHaveLength(2);
    expect(existsSync(join(target, 'arquivos-da-mesa'))).toBe(false);
    expect(existsSync(join(target, 'biblioteca'))).toBe(false);
    reading.close();
    db.close();
  });

  it('a biblioteca recopia um arquivo editado (mesmo tamanho, horário novo)', async () => {
    const { db, filesDir, libraryDir, target } = fakeApp();
    const reading = new DatabaseSync(join(dir, 'zehenia.db'), { readOnly: true });
    await runDriveBackup({ db: reading, filesDir, libraryDir, target, key });
    const file = join(libraryDir, 'imagens', 'mapas', 'taverna.jpg');
    writeFileSync(file, 'TAVERNA');
    const later = new Date(Date.now() + 60_000);
    utimesSync(file, later, later);
    const report = await runDriveBackup({ db: reading, filesDir, libraryDir, target, key });
    expect(report.library.copied).toBe(1);
    expect(readFileSync(join(target, 'biblioteca', 'imagens', 'mapas', 'taverna.jpg'), 'utf8')).toBe('TAVERNA');
    reading.close();
    db.close();
  });
});
