import { Injectable, inject } from '@angular/core';
import { ApiClient } from '../api/api-client';
import { ServerTable, fromServerTable } from '../data/server/server-tables.repository';
import { GameTable } from '../models/game-table.model';

/** Membro de uma mesa online (o dono é o mestre; quem entrou por convite, jogador). */
export interface TableMember {
  userId: string;
  name: string;
  role: 'gm' | 'player';
  joinedAt: number;
}

/** Convite gerado pelo mestre: o código aparece uma vez só (o servidor guarda só o hash). */
export interface TableInvite {
  code: string;
  expiresAt: number;
}

/**
 * Jogadores e convites das mesas — só no modo online (offline não há outras contas).
 * O servidor confere os papéis: só o mestre convida e remove; o jogador pode sair.
 */
@Injectable({ providedIn: 'root' })
export class TableMembersService {
  private readonly api = inject(ApiClient);

  async members(tableId: string): Promise<TableMember[]> {
    return (await this.api.get<{ members: TableMember[] }>(`/tables/${encodeURIComponent(tableId)}/members`)).members;
  }

  /** Mestre remove um jogador; jogador passa o próprio id para sair da mesa. */
  async remove(tableId: string, userId: string): Promise<void> {
    await this.api.delete(`/tables/${encodeURIComponent(tableId)}/members/${encodeURIComponent(userId)}`);
  }

  /** Gera um código de convite (vale 7 dias, até o limite de jogadores da mesa). */
  createInvite(tableId: string): Promise<TableInvite> {
    return this.api.post<TableInvite>(`/tables/${encodeURIComponent(tableId)}/invites`);
  }

  /** Cancela todos os convites ainda válidos da mesa. */
  async revokeInvites(tableId: string): Promise<void> {
    await this.api.delete(`/tables/${encodeURIComponent(tableId)}/invites`);
  }

  /** Entra na mesa com o código recebido do mestre. */
  async acceptInvite(code: string): Promise<GameTable> {
    return fromServerTable((await this.api.post<{ table: ServerTable }>('/invites/accept', { code: code.trim() })).table);
  }
}
