import { Injectable, inject } from '@angular/core';
import { ApiClient } from '../../api/api-client';
import { GameTable, NewGameTable } from '../../models/game-table.model';
import { User } from '../../models/user.model';
import type { TablesRepository } from '../tables.repository';

/** Mesa como o servidor devolve (`/api/tables`): o papel da conta vem junto. */
export interface ServerTable {
  id: string;
  ownerId: string;
  worldId: string;
  name: string;
  system: string;
  description: string;
  maxPlayers: number;
  accent: string;
  createdAt: number;
  role: 'gm' | 'player';
}

/** Mesa do servidor no formato do app (mesmo `GameTable`, com o papel). */
export function fromServerTable(table: ServerTable): GameTable {
  return { ...table };
}

/**
 * Mesas do modo online (`/api/tables`): as que a conta mestra e as em que entrou por convite.
 * O servidor confere dono e participação; excluir apaga estado, membros, convites e arquivos.
 */
@Injectable({ providedIn: 'root' })
export class ServerTablesRepository implements TablesRepository {
  private readonly api = inject(ApiClient);

  async list(_user: User): Promise<GameTable[]> {
    return (await this.api.get<{ tables: ServerTable[] }>('/tables')).tables.map(fromServerTable);
  }

  async create(_user: User, data: NewGameTable): Promise<GameTable> {
    const { name, system, description, maxPlayers, accent, worldId } = data;
    const body = { name, system, description, maxPlayers, accent, ...(worldId && { worldId }) };
    return fromServerTable((await this.api.post<{ table: ServerTable }>('/tables', body)).table);
  }

  async remove(_user: User, id: string): Promise<void> {
    await this.api.delete(`/tables/${encodeURIComponent(id)}`);
  }
}
