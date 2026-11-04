import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import { ServerAccountService } from '../../../core/services/server-account.service';

/** Lê o token do fragmento da URL (`#token=…`) e o tira da barra de endereço e do histórico. */
function takeTokenFromUrl(): string {
  const token = new URLSearchParams(location.hash.slice(1)).get('token') ?? '';
  if (location.hash) history.replaceState(null, '', location.pathname);
  return token;
}

/**
 * Página aberta pelo link de recuperação de senha (rota `redefinir-senha`), para a conta do servidor.
 *
 * O token vem no fragmento da URL: o fragmento não vai ao servidor, a logs nem a outros sites.
 * Depois de redefinir, todas as sessões da conta caem e a pessoa entra de novo com a senha nova.
 */
@Component({
  selector: 'app-reset-password',
  imports: [ReactiveFormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressSpinnerModule],
  templateUrl: './reset-password.html',
  host: { class: 'flex min-h-full items-center justify-center p-6' },
})
export class ResetPassword {
  private readonly account = inject(ServerAccountService);

  private readonly token = takeTokenFromUrl();
  /** O link trazia um token? Sem ele, só resta pedir outro. */
  readonly hasToken = !!this.token;
  readonly loading = signal(false);
  readonly error = signal('');
  readonly done = signal(false);
  readonly showPassword = signal(false);

  readonly form = inject(FormBuilder).nonNullable.group({
    password: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(128)]],
  });

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    this.error.set('');
    try {
      await this.account.resetPassword(this.token, this.form.getRawValue().password);
      this.done.set(true);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Algo deu errado. Tente novamente.');
    } finally {
      this.loading.set(false);
    }
  }
}
