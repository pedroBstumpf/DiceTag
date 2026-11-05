import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router } from '@angular/router';
import { OnlineTablesService } from '../../../core/services/online-tables.service';
import { ServerAccountService } from '../../../core/services/server-account.service';

/** Lê o código do fragmento da URL (`#codigo=…`) e o tira da barra de endereço e do histórico. */
function takeCodeFromUrl(): string {
  const code = new URLSearchParams(location.hash.slice(1)).get('codigo') ?? '';
  if (location.hash) history.replaceState(null, '', location.pathname);
  return code;
}

/**
 * Página aberta pelo link de convite: a pessoa escolhe o nome que os outros vão ver e já entra na
 * mesa, sem cadastro nem senha. O link é de uso único e o código vem no fragmento da URL, que não
 * vai ao servidor nem a logs. Quem já tem conta neste navegador entra com ela.
 */
@Component({
  selector: 'app-invite',
  imports: [MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressSpinnerModule],
  templateUrl: './invite.html',
  host: { class: 'flex min-h-dvh items-center justify-center p-6' },
})
export class Invite {
  readonly account = inject(ServerAccountService);
  private readonly tables = inject(OnlineTablesService);
  private readonly router = inject(Router);

  /** Veio no link; sem ele, a pessoa pode colar o código que recebeu. */
  readonly code = signal(takeCodeFromUrl());
  readonly fromLink = !!this.code();
  readonly name = signal('');
  readonly loading = signal(false);
  readonly error = signal('');

  constructor() {
    void this.account.ensureChecked();
  }

  /** Entra: com a conta que já existe neste navegador ou criando a de convidado. */
  async enter(): Promise<void> {
    const code = this.code().trim();
    if (!code) return;
    this.loading.set(true);
    this.error.set('');
    try {
      const table = this.account.user() ? await this.tables.accept(code) : await this.account.redeem(code, this.name().trim() || undefined);
      await this.router.navigate(['/mesa-online', table.id]);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Não foi possível entrar. Peça outro convite.');
    } finally {
      this.loading.set(false);
    }
  }
}
