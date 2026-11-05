import { Component, DestroyRef, computed, effect, inject, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { HostService } from '../../../core/services/host.service';

/** De quanto em quanto a tela confere a situação enquanto espera a aprovação na conta do Tailscale. */
const POLL_MS = 3000;

/**
 * Painel "Abrir para os jogadores" (só o dono, em Minhas mesas): o botão que coloca a mesa na
 * internet pelo Tailscale Funnel e tira de novo, e o que fazer quando ainda falta algo.
 */
@Component({
  selector: 'app-host-panel',
  imports: [MatButtonModule, MatIconModule, MatTooltipModule],
  templateUrl: './host-panel.html',
})
export class HostPanel {
  readonly host = inject(HostService);
  private readonly snackBar = inject(MatSnackBar);

  readonly status = this.host.status;
  /** O app foi aberto neste computador (só daqui dá para abrir e fechar). */
  readonly local = computed(() => this.status()?.local ?? false);

  constructor() {
    void this.refresh();
    // Aguardando a aprovação na página do Tailscale: a tela segue sozinha quando ela vier
    const poll = setInterval(() => {
      if (this.status()?.state === 'approval' || this.status()?.state === 'logged-out') void this.refresh();
    }, POLL_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(poll));
    // Primeira informação, ou mudança para aberta: o aviso de erro volta a aparecer quando vier
    effect(() => {
      const message = this.status()?.state === 'error' ? this.status()?.message : '';
      if (message) untracked(() => this.snackBar.open(message, 'OK', { duration: 8000 }));
    });
  }

  private async refresh(): Promise<void> {
    await this.host.refresh().catch(() => undefined);
  }

  async copy(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      this.snackBar.open('Endereço copiado.');
    } catch {
      this.snackBar.open('Não foi possível copiar: selecione e copie à mão.');
    }
  }

  async open(): Promise<void> {
    await this.host.open().catch((e: unknown) => this.snackBar.open(e instanceof Error ? e.message : 'Não foi possível abrir a mesa.'));
  }

  async close(): Promise<void> {
    await this.host.close().catch((e: unknown) => this.snackBar.open(e instanceof Error ? e.message : 'Não foi possível fechar a mesa.'));
  }
}
