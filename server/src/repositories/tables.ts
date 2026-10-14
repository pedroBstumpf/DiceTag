import type { Db } from '../db/database';
import type { TableRole } from '../domain';

/** Mesa como vista pelo cliente (mesmo formato do `GameTable` do front-end + o papel de quem pede). */
export interface TableRecord {
  id: string;
  ownerId: string;
  worldId: string;
  name: string;
  system: string;
  description: string;
  maxPlayers: number;
  accent: string;
  createdAt: number;
}

export interface MemberRecord {
  userId: string;
  role: TableRole;
  joinedAt: number;
}

export interface InviteRecord {
  tableId: string;
  expiresAt: number;
  maxUses: number;
  uses: number;
}

/**
 * Mesas, membros (papel vem da conta: dono = mestre, convidado = jogador), convites e o
 * estado salvo de cada mesa (snapshot + versão).
 */
export class TablesRepository {
  constructor(private readonly db: Db) {}

  // --- Mesas -----------------------------------------------------------------

  create(table: TableRecord): void {
    this.db
      .prepare(
        `INSERT INTO game_tables (id, owner_id, world_id, name, system, description, max_players, accent, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(table.id, table.ownerId, table.worldId, table.name, table.system, table.description, table.maxPlayers, table.accent, table.createdAt);
    this.addMember(table.id, table.ownerId, 'gm', table.createdAt);
  }

  find(id: string): TableRecord | null {
    const row = this.db.prepare('SELECT * FROM game_tables WHERE id = ?').get(id) as TableRow | undefined;
    return row ? toTable(row) : null;
  }

  /** Mesas em que a conta participa (como mestre ou jogador), mais recentes primeiro. */
  listForUser(userId: string): (TableRecord & { role: TableRole })[] {
    const rows = this.db
      .prepare(
        `SELECT t.*, m.role FROM game_tables t JOIN table_members m ON m.table_id = t.id
         WHERE m.user_id = ? ORDER BY t.created_at DESC`,
      )
      .all(userId) as unknown as (TableRow & { role: TableRole })[];
    return rows.map((r) => ({ ...toTable(r), role: r.role }));
  }

  update(id: string, patch: Partial<Pick<TableRecord, 'name' | 'system' | 'description' | 'maxPlayers' | 'accent'>>): void {
    const current = this.find(id);
    if (!current) return;
    const next = { ...current, ...patch };
    this.db
      .prepare('UPDATE game_tables SET name = ?, system = ?, description = ?, max_players = ?, accent = ? WHERE id = ?')
      .run(next.name, next.system, next.description, next.maxPlayers, next.accent, id);
  }

  /** Apaga a mesa; membros, convites e estado saem em cascata. */
  delete(id: string): void {
    this.db.prepare('DELETE FROM game_tables WHERE id = ?').run(id);
  }

  countByWorld(worldId: string): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM game_tables WHERE world_id = ?').get(worldId) as { n: number }).n);
  }

  // --- Membros ---------------------------------------------------------------

  roleOf(tableId: string, userId: string): TableRole | null {
    const row = this.db.prepare('SELECT role FROM table_members WHERE table_id = ? AND user_id = ?').get(tableId, userId) as
      | { role: TableRole }
      | undefined;
    return row?.role ?? null;
  }

  members(tableId: string): MemberRecord[] {
    const rows = this.db.prepare('SELECT user_id, role, joined_at FROM table_members WHERE table_id = ? ORDER BY joined_at').all(tableId) as {
      user_id: string;
      role: TableRole;
      joined_at: number;
    }[];
    return rows.map((r) => ({ userId: r.user_id, role: r.role, joinedAt: r.joined_at }));
  }

  playerCount(tableId: string): number {
    return Number(
      (this.db.prepare("SELECT COUNT(*) AS n FROM table_members WHERE table_id = ? AND role = 'player'").get(tableId) as { n: number }).n,
    );
  }

  addMember(tableId: string, userId: string, role: TableRole, now: number): void {
    this.db.prepare('INSERT INTO table_members (table_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(tableId, userId, role, now);
  }

  removeMember(tableId: string, userId: string): void {
    this.db.prepare('DELETE FROM table_members WHERE table_id = ? AND user_id = ?').run(tableId, userId);
  }

  /** A conta participa de alguma mesa que se passa neste mundo? (acesso às imagens do mundo) */
  isMemberOfWorldTable(worldId: string, userId: string): boolean {
    return !!this.db
      .prepare('SELECT 1 FROM game_tables t JOIN table_members m ON m.table_id = t.id WHERE t.world_id = ? AND m.user_id = ? LIMIT 1')
      .get(worldId, userId);
  }

  // --- Convites --------------------------------------------------------------

  createInvite(codeHash: string, tableId: string, createdBy: string, now: number, expiresAt: number, maxUses: number): void {
    this.db
      .prepare('INSERT INTO table_invites (code_hash, table_id, created_by, created_at, expires_at, max_uses) VALUES (?, ?, ?, ?, ?, ?)')
      .run(codeHash, tableId, createdBy, now, expiresAt, maxUses);
  }

  findInvite(codeHash: string): InviteRecord | null {
    const row = this.db.prepare('SELECT * FROM table_invites WHERE code_hash = ?').get(codeHash) as
      | { table_id: string; expires_at: number; max_uses: number; uses: number }
      | undefined;
    return row ? { tableId: row.table_id, expiresAt: row.expires_at, maxUses: row.max_uses, uses: row.uses } : null;
  }

  useInvite(codeHash: string): void {
    this.db.prepare('UPDATE table_invites SET uses = uses + 1 WHERE code_hash = ?').run(codeHash);
  }

  revokeInvites(tableId: string): void {
    this.db.prepare('DELETE FROM table_invites WHERE table_id = ?').run(tableId);
  }

  // --- Estado da mesa ----------------------------------------------------------

  loadState(tableId: string): { state: unknown; version: number } | null {
    const row = this.db.prepare('SELECT state, version FROM table_states WHERE table_id = ?').get(tableId) as
      | { state: string; version: number }
      | undefined;
    return row ? { state: JSON.parse(row.state) as unknown, version: row.version } : null;
  }

  saveState(tableId: string, json: string, version: number, now: number): void {
    this.db
      .prepare(
        `INSERT INTO table_states (table_id, state, version, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (table_id) DO UPDATE SET state = excluded.state, version = excluded.version, updated_at = excluded.updated_at`,
      )
      .run(tableId, json, version, now);
  }
}

interface TableRow {
  id: string;
  owner_id: string;
  world_id: string;
  name: string;
  system: string;
  description: string;
  max_players: number;
  accent: string;
  created_at: number;
}

function toTable(row: TableRow): TableRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    worldId: row.world_id,
    name: row.name,
    system: row.system,
    description: row.description,
    maxPlayers: row.max_players,
    accent: row.accent,
    createdAt: row.created_at,
  };
}
