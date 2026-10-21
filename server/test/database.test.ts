import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, transaction } from '../src/db/database';
import { MIGRATIONS } from '../src/db/migrations';

/**
 * Banco: migrações registradas e só para frente, backup antes de migrar, adoção de bancos da
 * versão anterior, chaves estrangeiras ligadas e transações aninhadas.
 */

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zehenia-db-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const versions = (db: DatabaseSync) => (db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[]).map((r) => r.version);

describe('migrações', () => {
  it('banco novo: aplica todas e registra cada uma em schema_migrations', () => {
    const db = openDatabase(':memory:');
    expect(versions(db)).toEqual(MIGRATIONS.map((_, i) => i + 1));
    db.close();
  });

  it('banco da versão anterior (user_version) é adotado sem reaplicar nada', () => {
    const path = join(dir, 'antigo.db');
    const legacy = new DatabaseSync(path);
    legacy.exec(MIGRATIONS[0]);
    legacy.exec('PRAGMA user_version = 1');
    legacy.close();
    const db = openDatabase(path);
    expect(versions(db)).toEqual([1]);
    db.close();
  });

  it('com o banco em uso, faz backup antes de aplicar as pendentes (e só então)', () => {
    const path = join(dir, 'zehenia.db');
    const db = openDatabase(path);
    db.prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES ('u', 'a@b.co', 'A', 'h', 0)").run();
    expect(readdirSync(dir)).not.toContain('backups');

    migrate(db, path, [...MIGRATIONS, 'CREATE TABLE nova (id TEXT PRIMARY KEY) STRICT']);
    const [backup] = readdirSync(join(dir, 'backups'));
    expect(backup).toMatch(/^zehenia-.*-antes-v2\.db$/);
    const copy = new DatabaseSync(join(dir, 'backups', backup));
    expect(copy.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 1 });
    expect(copy.prepare("SELECT name FROM sqlite_master WHERE name = 'nova'").get()).toBeUndefined();
    copy.close();
    db.close();
  });
});

describe('configuração e transações', () => {
  it('chaves estrangeiras ligadas: apagar a conta apaga o que é dela', () => {
    const db = openDatabase(':memory:');
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    db.prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES ('u', 'a@b.co', 'A', 'h', 0)").run();
    db.prepare("INSERT INTO worlds (id, owner_id, name, created_at) VALUES ('w', 'u', 'Mundo', 0)").run();
    db.prepare("DELETE FROM users WHERE id = 'u'").run();
    expect(db.prepare('SELECT COUNT(*) AS n FROM worlds').get()).toEqual({ n: 0 });
    db.close();
  });

  it('transação aninhada: a interna desfaz só a parte dela', () => {
    const db = openDatabase(':memory:');
    const add = (id: string) => db.prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, 'A', 'h', 0)").run(id, `${id}@b.co`);
    transaction(db, () => {
      add('fora');
      expect(() =>
        transaction(db, () => {
          add('dentro');
          throw new Error('falhou');
        }),
      ).toThrow('falhou');
    });
    expect((db.prepare('SELECT id FROM users').all() as { id: string }[]).map((r) => r.id)).toEqual(['fora']);
    db.close();
  });
});
