import { Injectable, inject, signal } from '@angular/core';
import { GameTable, NewGameTable } from '../models/game-table.model';
import { TableRole } from '../models/table-session.model';
import { ServerApiService } from './server-api.service';

/** Mesa do servidor como a conta a vê: os dados da mesa + o papel dela (dono = mestre, convite = jogador). */
export interface OnlineTable extends GameTable {
  worldId: string;
  role: TableRole;
}

/** Convite gerado pelo mestre, de uso único: aparece uma vez só (o servidor guarda só o hash). */
export interface TableInvite {
  code: string;
  /** Link pronto para enviar: leva o código no fragmento (depois do #). */
  link: string;
  expiresAt: number;
}

/** Quem participa da mesa. */
export interface TableMember {
  userId: string;
  name: string;
  role: TableRole;
  joinedAt: number;
}

/**
 * Mesas online (servidor): listar, criar, excluir, convidar, entrar com convite e sair.
 * Todas as regras (quem pode o quê) são do servidor; aqui só há as chamadas e a lista na tela.
 */
@Injectable({ providedIn: 'root' })
export class OnlineTablesService {
  private readonly api = inject(ServerApiService);

  /** Mesas da conta do servidor, mais recentes primeiro (ordem do servidor). */
  readonly tables = signal<OnlineTable[]>([]);
  readonly loading = signal(false);

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.tables.set((await this.api.get<{ tables: OnlineTable[] }>('/tables')).tables);
    } finally {
      this.loading.set(false);
    }
  }

  /** Esquece a lista (ao sair da conta do servidor). */
  clear(): void {
    this.tables.set([]);
  }

  async create(data: Omit<NewGameTable, 'worldId'>): Promise<OnlineTable> {
    const { table } = await this.api.post<{ table: OnlineTable }>('/tables', data);
    this.tables.update((list) => [table, ...list]);
    return table;
  }

  /** Mesa aberta pela página da mesa online (404 = não existe ou a conta não participa). */
  async get(id: string): Promise<OnlineTable> {
    return (await this.api.get<{ table: OnlineTable }>(`/tables/${encodeURIComponent(id)}`)).table;
  }

  /** Exclui a mesa (só o dono): o servidor apaga estado, membros, convites e arquivos. */
  async remove(id: string): Promise<void> {
    await this.api.delete(`/tables/${encodeURIComponent(id)}`);
    this.tables.update((list) => list.filter((t) => t.id !== id));
  }

  /** Jogador sai da mesa. */
  async leave(id: string, userId: string): Promise<void> {
    await this.api.delete(`/tables/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`);
    this.tables.update((list) => list.filter((t) => t.id !== id));
  }

  /** Gera um convite (mestre), de uso único, válido por 7 dias. */
  invite(id: string): Promise<TableInvite> {
    return this.api.post<TableInvite>(`/tables/${encodeURIComponent(id)}/invites`);
  }

  /** Quem participa da mesa. */
  async members(id: string): Promise<TableMember[]> {
    return (await this.api.get<{ members: TableMember[] }>(`/tables/${encodeURIComponent(id)}/members`)).members;
  }

  /** Mestre tira um jogador da mesa. */
  async removeMember(id: string, userId: string): Promise<void> {
    await this.api.delete(`/tables/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`);
  }

  /** Link de retorno: o convidado que trocou de aparelho volta à mesma conta (uso único). */
  accessLink(id: string, userId: string): Promise<TableInvite> {
    return this.api.post<TableInvite>(`/tables/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}/access-link`);
  }

  /** Entra numa mesa com o código (como jogador) e a põe na lista. */
  async accept(code: string): Promise<OnlineTable> {
    const { table } = await this.api.post<{ table: OnlineTable }>('/invites/accept', { code: code.trim() });
    this.tables.update((list) => [table, ...list.filter((t) => t.id !== table.id)]);
    return table;
  }
}
