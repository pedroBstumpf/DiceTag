import { transaction, type Db } from '../db/database';

export interface WorldRecord {
  id: string;
  ownerId: string;
  name: string;
  createdAt: number;
}

/** Limites do Worldbuild por mundo (evitam que uma conta encha o disco do servidor). */
export const MAX_WORLD_ITEMS = 5000;

/** Condição SQL: o mundo `world_id` (ou `id`) pertence à conta do parâmetro. */
const OWNED_WORLD = 'SELECT 1 FROM worlds w WHERE w.id = world_items.world_id AND w.owner_id = ?';

/**
 * Mundos do usuário e os itens do Worldbuild de cada um.
 * Itens são JSON já validado pela rota (o repositório não interpreta o conteúdo).
 *
 * Toda consulta feita em nome de uma conta confere o dono **na própria consulta**
 * (`... AND owner_id = ?`), não só na rota (BACKEND_SECURITY.md §3): um método reaproveitado sem
 * a conferência continua sem enxergar o mundo de outra pessoa. Os poucos métodos sem conta
 * (`findItem`, `countItems`, `hasItem`) são de uso interno, depois do acesso já conferido.
 */
export class WorldsRepository {
  constructor(private readonly db: Db) {}

  // --- Mundos ----------------------------------------------------------------

  listByOwner(ownerId: string): WorldRecord[] {
    return (this.db.prepare('SELECT * FROM worlds WHERE owner_id = ? ORDER BY created_at').all(ownerId) as unknown as WorldRow[]).map(toWorld);
  }

  /** Mundo da conta (null se não existe ou é de outra pessoa: a rota responde 404 nos dois casos). */
  findOwned(id: string, ownerId: string): WorldRecord | null {
    const row = this.db.prepare('SELECT * FROM worlds WHERE id = ? AND owner_id = ?').get(id, ownerId) as WorldRow | undefined;
    return row ? toWorld(row) : null;
  }

  countByOwner(ownerId: string): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM worlds WHERE owner_id = ?').get(ownerId) as { n: number }).n);
  }

  create(world: WorldRecord): void {
    this.db.prepare('INSERT INTO worlds (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)').run(world.id, world.ownerId, world.name, world.createdAt);
  }

  rename(id: string, ownerId: string, name: string): boolean {
    return Number(this.db.prepare('UPDATE worlds SET name = ? WHERE id = ? AND owner_id = ?').run(name, id, ownerId).changes) > 0;
  }

  /** Apaga o mundo da conta e (em cascata) os itens dele. */
  delete(id: string, ownerId: string): boolean {
    return Number(this.db.prepare('DELETE FROM worlds WHERE id = ? AND owner_id = ?').run(id, ownerId).changes) > 0;
  }

  // --- Itens -----------------------------------------------------------------

  /** Itens de um mundo da conta. */
  listItems(worldId: string, ownerId: string): unknown[] {
    const rows = this.db
      .prepare(`SELECT data FROM world_items WHERE world_id = ? AND EXISTS (${OWNED_WORLD})`)
      .all(worldId, ownerId) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as unknown);
  }

  /** Itens do mundo de uma mesa da qual a conta participa (aba Lore; a rota projeta para o jogador). */
  listItemsForMember(tableId: string, userId: string): unknown[] {
    const rows = this.db
      .prepare(
        `SELECT i.data FROM world_items i
         JOIN game_tables t ON t.world_id = i.world_id
         JOIN table_members m ON m.table_id = t.id
         WHERE t.id = ? AND m.user_id = ?`,
      )
      .all(tableId, userId) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as unknown);
  }

  /** Uso interno (sala da mesa, depois de conferir a participação): um item do mundo. */
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

  /** Cria ou substitui um item num mundo da conta (false = o mundo não é dela). */
  upsertItem(worldId: string, ownerId: string, id: string, data: string, now: number): boolean {
    const result = this.db
      .prepare(
        `INSERT INTO world_items (world_id, id, data, updated_at)
         SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM worlds WHERE id = ? AND owner_id = ?)
         ON CONFLICT (world_id, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(worldId, id, data, now, worldId, ownerId);
    return Number(result.changes) > 0;
  }

  /** Apaga itens de um mundo da conta, numa transação. Devolve quantos foram apagados. */
  deleteItems(worldId: string, ownerId: string, ids: readonly string[]): number {
    const stmt = this.db.prepare(`DELETE FROM world_items WHERE world_id = ? AND id = ? AND EXISTS (${OWNED_WORLD})`);
    return transaction(this.db, () => ids.reduce((sum, id) => sum + Number(stmt.run(worldId, id, ownerId).changes), 0));
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
