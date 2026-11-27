import { Injectable, inject, signal } from '@angular/core';
import { OnlineTable } from './online-tables.service';
import { ServerApiService } from './server-api.service';

/** Resumo de uma mesa do Mestre (`GET /api/gm/overview`): contagens e datas, nada do conteúdo da partida. */
export interface GmTableSummary extends OnlineTable {
  worldName: string;
  /** Jogadores (convidados) na mesa. */
  players: number;
  /** Convites novos ainda válidos. */
  pendingInvites: number;
  /** Cenas no último estado gravado (0 = mesa nunca aberta). */
  scenes: number;
  /** Última gravação do estado (null = nunca aberta). */
  stateUpdatedAt: number | null;
  /** Contas conectadas à sala agora. */
  online: number;
}

export interface GmOverview {
  tables: GmTableSummary[];
  totals: { tables: number; players: number; pendingInvites: number; online: number };
}

/**
 * Painel do Mestre (ADR-0007): lê o resumo das mesas do dono. As ações (criar, convidar, editar,
 * excluir) usam o `OnlineTablesService`, sobre as rotas que já conferem o papel no servidor.
 */
@Injectable({ providedIn: 'root' })
export class GmService {
  private readonly api = inject(ServerApiService);

  readonly overview = signal<GmOverview | null>(null);
  readonly loading = signal(false);

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.overview.set(await this.api.get<GmOverview>('/gm/overview'));
    } finally {
      this.loading.set(false);
    }
  }
}
