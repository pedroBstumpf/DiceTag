import type { Db } from '../db/database';

export interface WorldRecord {
  id: string;
  ownerId: string;
  name: string;
  createdAt: number;
}

/** Limites do Worldbuild por mundo (evitam que uma conta encha o disco do servidor). */
export const MAX_WORLD_ITEMS = 5000;

/**
 * Mundos do usuário e os itens do Worldbuild de cada um.
 * Itens são JSON já validado pela rota (o repositório não interpreta o conteúdo).
 */
export class WorldsRepository {
  constructor(private readonly db: Db) {}

  // --- Mundos ----------------------------------------------------------------

  listByOwner(ownerId: string): WorldRecord[] {
    return (this.db.prepare('SELECT * FROM worlds WHERE owner_id = ? ORDER BY created_at').all(ownerId) as unknown as WorldRow[]).map(toWorld);
  }

  find(id: string): WorldRecord | null {
    const row = this.db.prepare('SELECT * FROM worlds WHERE id = ?').get(id) as WorldRow | undefined;
    return row ? toWorld(row) : null;
  }

  countByOwner(ownerId: string): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM worlds WHERE owner_id = ?').get(ownerId) as { n: number }).n);
  }

  create(world: WorldRecord): void {
    this.db.prepare('INSERT INTO worlds (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)').run(world.id, world.ownerId, world.name, world.createdAt);
  }

  rename(id: string, name: string): void {
    this.db.prepare('UPDATE worlds SET name = ? WHERE id = ?').run(name, id);
  }

  /** Apaga o mundo e (em cascata) os itens dele. */
  delete(id: string): void {
    this.db.prepare('DELETE FROM worlds WHERE id = ?').run(id);
  }

  // --- Itens -----------------------------------------------------------------

  listItems(worldId: string): unknown[] {
    const rows = this.db.prepare('SELECT data FROM world_items WHERE world_id = ?').all(worldId) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as unknown);
  }

  findItem(worldId: string, id: string): unknown | null {
    const row = this.db.prepare('SELECT data FROM world_items WHERE world_id = ? AND id = ?').get(worldId, id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as unknown) : null;
  }

  countItems(worldId: string): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM world_items WHERE world_id = ?').get(worldId) as { n: number }).n);
  }

  hasItem(worldId: string, id: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM world_items WHERE world_id = ? AND id = ?').get(worldId, id);
  }

  upsertItem(worldId: string, id: string, data: string, now: number): void {
    this.db
      .prepare(
        `INSERT INTO world_items (world_id, id, data, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (world_id, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(worldId, id, data, now);
  }

  deleteItems(worldId: string, ids: readonly string[]): number {
    const stmt = this.db.prepare('DELETE FROM world_items WHERE world_id = ? AND id = ?');
    return ids.reduce((sum, id) => sum + Number(stmt.run(worldId, id).changes), 0);
  }
}

interface WorldRow {
  id: string;
  owner_id: string;
  name: string;
  created_at: number;
}

function toWorld(row: WorldRow): WorldRecord {
  return { id: row.id, ownerId: row.owner_id, name: row.name, createdAt: row.created_at };
}
