import { Injectable, inject, signal } from '@angular/core';
import { ServerApiService } from './server-api.service';

/** Situação da mesa, como o servidor informa (`server/src/ops/tailscale.ts`). */
export interface HostStatus {
  state: 'unavailable' | 'not-installed' | 'logged-out' | 'closed' | 'approval' | 'open' | 'error';
  url?: string;
  approvalUrl?: string;
  message?: string;
  /** O pedido veio do computador onde o app roda? Só de lá dá para abrir e fechar a mesa. */
  local: boolean;
}

/** Abrir e fechar a mesa para os jogadores (Tailscale Funnel), pelo app. Só o dono usa. */
@Injectable({ providedIn: 'root' })
export class HostService {
  private readonly api = inject(ServerApiService);

  readonly status = signal<HostStatus | null>(null);
  readonly busy = signal(false);

  async refresh(): Promise<void> {
    this.status.set(await this.api.get<HostStatus>('/host'));
  }

  async open(): Promise<void> {
    await this.during(() => this.api.post<HostStatus>('/host/open'));
  }

  async close(): Promise<void> {
    await this.during(() => this.api.post<HostStatus>('/host/close'));
  }

  /** Abre a pasta da biblioteca no Explorador deste computador. */
  async openFolder(): Promise<void> {
    await this.api.post('/host/open-folder');
  }

  private async during(call: () => Promise<HostStatus>): Promise<void> {
    this.busy.set(true);
    try {
      this.status.set(await call());
    } finally {
      this.busy.set(false);
    }
  }
}
