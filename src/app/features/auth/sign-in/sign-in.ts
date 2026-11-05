import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router } from '@angular/router';
import { ServerAccountService } from '../../../core/services/server-account.service';

/**
 * Página de entrada. Só o dono do app entra com senha: não há cadastro, e os amigos dele entram
 * pelo link de convite (`features/auth/invite`).
 */
@Component({
  selector: 'app-sign-in',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressSpinnerModule],
  templateUrl: './sign-in.html',
  host: { class: 'flex min-h-dvh items-center justify-center p-6' },
})
export class SignIn {
  private readonly account = inject(ServerAccountService);
  private readonly router = inject(Router);

  readonly loading = signal(false);
  readonly error = signal('');
  readonly showPassword = signal(false);

  readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { email, password } = this.form.getRawValue();
    this.loading.set(true);
    this.error.set('');
    try {
      await this.account.login(email, password);
      await this.router.navigate(['/']);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Algo deu errado. Tente novamente.');
    } finally {
      this.loading.set(false);
    }
  }
}
