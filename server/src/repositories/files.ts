import { mkdirSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { transaction, type Db } from '../db/database';
import { isSafeId } from '../lib/ids';

export interface FileRecord {
  id: string;
  ownerId: string;
  tableId: string | null;
  worldId: string | null;
  mime: string;
  size: number;
  sha256: string;
  createdAt: number;
}

/**
 * Quem pode baixar o arquivo `f`: quem enviou, membro da mesa dele ou de uma mesa que se passa
 * no mundo dele. Parâmetros: a conta, três vezes.
 */
const CAN_SEE = `(
  f.owner_id = ?
  OR EXISTS (SELECT 1 FROM table_members m WHERE m.table_id = f.table_id AND m.user_id = ?)
  OR EXISTS (SELECT 1 FROM game_tables t JOIN table_members m ON m.table_id = t.id WHERE t.world_id = f.world_id AND m.user_id = ?)
)`;

/**
 * Arquivos enviados (mapas, imagens, áudios): metadados no banco, conteúdo em disco.
 *
 * O nome em disco é o id gerado pelo servidor (UUID), sem extensão e sem nada escolhido por
 * quem enviou: não há como montar um caminho para fora da pasta (path traversal) nem
 * sobrescrever outro arquivo. `pathOf` confere isso de novo antes de qualquer acesso.
 *
 * Quem pode ver ou apagar é conferido **na própria consulta** (BACKEND_SECURITY.md §3 e §8).
 */
export class FilesRepository {
  private readonly dir: string;

  constructor(
    private readonly db: Db,
    dir: string,
  ) {
    this.dir = resolve(dir);
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
  }

  /** Caminho em disco do arquivo `id` (lança se o id não for seguro). */
  pathOf(id: string): string {
    if (!isSafeId(id)) throw new Error('id de arquivo inválido');
    const path = resolve(this.dir, id);
    if (!path.startsWith(this.dir + sep)) throw new Error('caminho fora da pasta de arquivos');
    return path;
  }

  /** Grava o conteúdo (falha se já existir: `wx`) e registra os metadados. */
  async save(record: FileRecord, content: Buffer): Promise<void> {
    const path = this.pathOf(record.id);
    await writeFile(path, content, { flag: 'wx', mode: 0o600 });
    try {
      this.db
        .prepare('INSERT INTO files (id, owner_id, table_id, world_id, mime, size, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(record.id, record.ownerId, record.tableId, record.worldId, record.mime, record.size, record.sha256, record.createdAt);
    } catch (err) {
      await rm(path, { force: true });
      throw err;
    }
  }

  /** Arquivo que a conta pode baixar (null se não existe ou não pode: a rota responde 404 nos dois casos). */
  findAccessible(id: string, userId: string): FileRecord | null {
    const row = this.db.prepare(`SELECT f.* FROM files f WHERE f.id = ? AND ${CAN_SEE}`).get(id, userId, userId, userId) as FileRow | undefined;
    return row ? toFile(row) : null;
  }

  /**
   * Apaga o arquivo se a conta pode: quem enviou ou o mestre da mesa do arquivo.
   * Devolve false sem apagar nada caso contrário.
   */
  async deleteIfAllowed(id: string, userId: string): Promise<boolean> {
    const removed = this.db
      .prepare(
        `DELETE FROM files WHERE id = ? AND (
           owner_id = ? OR table_id IN (SELECT table_id FROM table_members WHERE user_id = ? AND role = 'gm')
         )`,
      )
      .run(id, userId, userId);
    if (!Number(removed.changes)) return false;
    await rm(this.pathOf(id), { force: true });
    return true;
  }

  /** Espaço usado pela conta, em bytes (para a cota). */
  usedBytes(ownerId: string): number {
    return Number((this.db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM files WHERE owner_id = ?').get(ownerId) as { n: number }).n);
  }

  idsByTable(tableId: string): string[] {
    return (this.db.prepare('SELECT id FROM files WHERE table_id = ?').all(tableId) as { id: string }[]).map((r) => r.id);
  }

  idsByWorld(worldId: string): string[] {
    return (this.db.prepare('SELECT id FROM files WHERE world_id = ?').all(worldId) as { id: string }[]).map((r) => r.id);
  }

  /**
   * Uso interno (mesa ou mundo excluídos pelo dono): apaga os registros numa transação e depois
   * o conteúdo em disco. Arquivo já ausente em disco não é erro.
   */
  async delete(ids: readonly string[]): Promise<void> {
    const stmt = this.db.prepare('DELETE FROM files WHERE id = ?');
    transaction(this.db, () => ids.forEach((id) => stmt.run(id)));
    for (const id of ids) await rm(this.pathOf(id), { force: true });
  }
}

interface FileRow {
  id: string;
  owner_id: string;
  table_id: string | null;
  world_id: string | null;
  mime: string;
  size: number;
  sha256: string;
  created_at: number;
}

function toFile(row: FileRow): FileRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    tableId: row.table_id,
    worldId: row.world_id,
    mime: row.mime,
    size: row.size,
    sha256: row.sha256,
    createdAt: row.created_at,
  };
}
