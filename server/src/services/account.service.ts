import type { AppContext } from '../context';
import { transaction } from '../db/database';
import type { TableCommand, TableEntry, TableState } from '../domain';
import type { RealtimeHub } from '../realtime/hub';
import type { FileRecord } from '../repositories/files';
import type { MemberRecord, MemberTable } from '../repositories/tables';
import type { PublicUser } from '../repositories/users';
import type { WorldRecord } from '../repositories/worlds';

/** Dados da conta exportados (LGPD: direito de acesso e portabilidade). */
export interface AccountExport {
  exportedAt: string;
  user: PublicUser;
  worlds: (WorldRecord & { items: unknown[] })[];
  tables: {
    /** Mesas de que a pessoa é dona (mestre): a mesa, os membros e o estado inteiro. */
    owned: { table: MemberTable; members: MemberRecord[]; state: TableState }[];
    /** Mesas de outros mestres: só as fichas da pessoa. */
    joined: { table: MemberTable; characters: TableEntry[] }[];
  };
  /** Metadados dos arquivos enviados (o conteúdo é baixado por `/api/files/:id`). */
  files: Omit<FileRecord, 'ownerId'>[];
}

const MASTER_VIEW = { role: 'gm' } as const;

/**
 * Direitos do titular dos dados (LGPD; BACKEND_SECURITY.md §14): exportar os dados da conta e
 * excluí-la. A exclusão remove em cascata as mesas próprias, o Worldbuild, os arquivos enviados
 * e as fichas da pessoa nas mesas de outros mestres (e o controle de NPCs que ela tinha).
 */
export class AccountService {
  constructor(
    private readonly ctx: AppContext,
    private readonly hub: RealtimeHub,
  ) {}

  export(user: PublicUser): AccountExport {
    const { ctx } = this;
    const worlds = ctx.worlds.listByOwner(user.id).map((w) => ({ ...w, items: ctx.worlds.listItems(w.id, user.id) }));
    const tables = ctx.tables.listForUser(user.id);
    const stateOf = (t: MemberTable) => this.hub.viewOf(t.id, t.worldId, { ...MASTER_VIEW, userId: user.id }).state;
    return {
      exportedAt: new Date().toISOString(),
      user,
      worlds,
      tables: {
        owned: tables.filter((t) => t.ownerId === user.id).map((table) => ({ table, members: ctx.tables.members(table.id, user.id), state: stateOf(table) })),
        joined: tables
          .filter((t) => t.ownerId !== user.id)
          .map((table) => ({ table, characters: stateOf(table).entries.filter((e) => ownedCharacter(e, user.id)) })),
      },
      files: ctx.files.listByOwner(user.id).map(({ ownerId: _owner, ...file }) => file),
    };
  }

  /** Exclui a conta e tudo o que é dela. Quem chama já conferiu a senha. */
  async delete(userId: string): Promise<void> {
    const { ctx, hub } = this;
    const tables = ctx.tables.listForUser(userId);
    const owned = tables.filter((t) => t.ownerId === userId);
    // Fichas da pessoa nas mesas dos outros saem (com os tokens e as ações delas)
    for (const t of tables.filter((t) => t.ownerId !== userId)) hub.applyServerCommands(t.id, t.worldId, (state) => personalDataCommands(state, userId));

    const fileIds = new Set([
      ...ctx.files.idsByOwner(userId),
      ...owned.flatMap((t) => ctx.files.idsByTable(t.id)),
      ...ctx.worlds.listByOwner(userId).flatMap((w) => ctx.files.idsByWorld(w.id)),
    ]);
    hub.userSessionsEnded(userId);
    for (const t of owned) hub.closeRoom(t.id);
    // Mesas primeiro (os mundos não podem ser apagados com mesas neles); a conta leva o resto em cascata
    transaction(ctx.db, () => {
      for (const t of owned) ctx.tables.delete(t.id, userId);
      ctx.users.delete(userId);
    });
    await ctx.files.delete([...fileIds]);
  }
}

function ownedCharacter(entry: TableEntry, userId: string): boolean {
  return entry.kind === 'character' && entry.ownerUserId === userId;
}

/** Comandos que tiram de uma mesa os dados pessoais da conta: as fichas dela e o controle de NPCs. */
function personalDataCommands(state: TableState, userId: string): TableCommand[] {
  return state.entries.flatMap((entry): TableCommand[] => {
    if (ownedCharacter(entry, userId)) return [{ type: 'removeEntry', payload: { entryId: entry.id } }];
    if (entry.kind === 'npc' && entry.controllerUserId === userId) {
      return [{ type: 'updateEntry', payload: { entryId: entry.id, patch: { controllerUserId: undefined } } }];
    }
    return [];
  });
}
