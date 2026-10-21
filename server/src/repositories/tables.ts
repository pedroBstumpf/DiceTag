import { transaction, type Db } from '../db/database';
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

/** Mesa vista por um membro: com o papel dele. */
export type MemberTable = TableRecord & { role: TableRole };

export interface MemberRecord {
  userId: string;
  name: string;
  role: TableRole;
  joinedAt: number;
}

export interface InviteRecord {
  tableId: string;
  expiresAt: number;
  maxUses: number;
  uses: number;
}

export type TablePatch = Partial<Pick<TableRecord, 'name' | 'system' | 'description' | 'maxPlayers' | 'accent'>>;

/** Condição SQL: a conta do parâmetro é mestre da mesa `game_tables.id`. */
const IS_GM = "SELECT 1 FROM table_members g WHERE g.table_id = game_tables.id AND g.user_id = ? AND g.role = 'gm'";

/**
 * Mesas, membros (papel vem da conta: dono = mestre, convidado = jogador), convites e o
 * estado salvo de cada mesa (snapshot + versão).
 *
 * Consultas feitas em nome de uma conta conferem a participação ou o papel **na própria
 * consulta** (JOIN com `table_members`, BACKEND_SECURITY.md §3). Os métodos sem conta (`find`,
 * `loadState`, `playerCount`…) são de uso interno, depois do acesso já conferido.
 */
export class TablesRepository {
  constructor(private readonly db: Db) {}

  // --- Mesas -----------------------------------------------------------------

  /** Cria a mesa e o dono como mestre, numa transação. */
  create(table: TableRecord): void {
    transaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO game_tables (id, owner_id, world_id, name, system, description, max_players, accent, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(table.id, table.ownerId, table.worldId, table.name, table.system, table.description, table.maxPlayers, table.accent, table.createdAt);
      this.addMember(table.id, table.ownerId, 'gm', table.createdAt);
    });
  }

  /** Mesa de que a conta participa, com o papel dela (null se não existe ou não participa). */
  findForMember(id: string, userId: string): MemberTable | null {
    const row = this.db
      .prepare('SELECT t.*, m.role FROM game_tables t JOIN table_members m ON m.table_id = t.id WHERE t.id = ? AND m.user_id = ?')
      .get(id, userId) as (TableRow & { role: TableRole }) | undefined;
    return row ? { ...toTable(row), role: row.role } : null;
  }

  /** Uso interno (convite já conferido): a mesa pelo id. */
  find(id: string): TableRecord | null {
    const row = this.db.prepare('SELECT * FROM game_tables WHERE id = ?').get(id) as TableRow | undefined;
    return row ? toTable(row) : null;
  }

  /** Mesas em que a conta participa (como mestre ou jogador), mais recentes primeiro. */
  listForUser(userId: string): MemberTable[] {
    const rows = this.db
      .prepare(
        `SELECT t.*, m.role FROM game_tables t JOIN table_members m ON m.table_id = t.id
         WHERE m.user_id = ? ORDER BY t.created_at DESC`,
      )
      .all(userId) as unknown as (TableRow & { role: TableRole })[];
    return rows.map((r) => ({ ...toTable(r), role: r.role }));
  }

  /** Altera a mesa se a conta for mestre dela (false = não é). */
  update(id: string, gmUserId: string, patch: TablePatch): boolean {
    const fields = { name: patch.name, system: patch.system, description: patch.description, max_players: patch.maxPlayers, accent: patch.accent };
    return (
      Number(
        this.db
          .prepare(
            `UPDATE game_tables SET
               name = COALESCE(?, name), system = COALESCE(?, system), description = COALESCE(?, description),
               max_players = COALESCE(?, max_players), accent = COALESCE(?, accent)
             WHERE id = ? AND EXISTS (${IS_GM})`,
          )
          .run(fields.name ?? null, fields.system ?? null, fields.description ?? null, fields.max_players ?? null, fields.accent ?? null, id, gmUserId)
          .changes,
      ) > 0
    );
  }

  /** Apaga a mesa do dono; membros, convites e estado saem em cascata. */
  delete(id: string, ownerId: string): boolean {
    return Number(this.db.prepare('DELETE FROM game_tables WHERE id = ? AND owner_id = ?').run(id, ownerId).changes) > 0;
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

  /** Membros da mesa, com o nome de cada um, para quem participa dela (vazio para os demais). */
  members(tableId: string, viewerId: string): MemberRecord[] {
    const rows = this.db
      .prepare(
        `SELECT m.user_id, u.name, m.role, m.joined_at FROM table_members m JOIN users u ON u.id = m.user_id
         WHERE m.table_id = ? AND EXISTS (SELECT 1 FROM table_members v WHERE v.table_id = m.table_id AND v.user_id = ?)
         ORDER BY m.joined_at`,
      )
      .all(tableId, viewerId) as { user_id: string; name: string; role: TableRole; joined_at: number }[];
    return rows.map((r) => ({ userId: r.user_id, name: r.name, role: r.role, joinedAt: r.joined_at }));
  }

  playerCount(tableId: string): number {
    return Number(
      (this.db.prepare("SELECT COUNT(*) AS n FROM table_members WHERE table_id = ? AND role = 'player'").get(tableId) as { n: number }).n,
    );
  }

  addMember(tableId: string, userId: string, role: TableRole, now: number): void {
    this.db.prepare('INSERT INTO table_members (table_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(tableId, userId, role, now);
  }

  /** Tira um jogador da mesa. O mestre (dono) nunca sai por aqui: só linhas de `player`. */
  removePlayer(tableId: string, userId: string): boolean {
    return Number(this.db.prepare("DELETE FROM table_members WHERE table_id = ? AND user_id = ? AND role = 'player'").run(tableId, userId).changes) > 0;
  }

  // --- Convites --------------------------------------------------------------

  /** Cria um convite se quem pede for mestre da mesa (false = não é). */
  createInvite(codeHash: string, tableId: string, gmUserId: string, now: number, expiresAt: number, maxUses: number): boolean {
    const result = this.db
      .prepare(
        `INSERT INTO table_invites (code_hash, table_id, created_by, created_at, expires_at, max_uses)
         SELECT ?, id, ?, ?, ?, ? FROM game_tables WHERE id = ? AND EXISTS (${IS_GM})`,
      )
      .run(codeHash, gmUserId, now, expiresAt, maxUses, tableId, gmUserId);
    return Number(result.changes) > 0;
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

  /** Cancela os convites da mesa, se quem pede for mestre dela. */
  revokeInvites(tableId: string, gmUserId: string): void {
    this.db
      .prepare(`DELETE FROM table_invites WHERE table_id IN (SELECT id FROM game_tables WHERE id = ? AND EXISTS (${IS_GM}))`)
      .run(tableId, gmUserId);
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
