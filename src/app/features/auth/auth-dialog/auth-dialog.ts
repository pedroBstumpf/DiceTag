import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { APP_MODE } from '../../../core/config/app-mode';
import { AuthService } from '../../../core/services/auth.service';

export type AuthMode = 'login' | 'register';

/**
 * Diálogo único para entrar ou criar conta, no modo em uso: online (conta no servidor, senha de
 * 8+) ou offline (conta só neste navegador). Fecha com `true` quando o usuário termina autenticado.
 */
@Component({
  selector: 'app-auth-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './auth-dialog.html',
})
export class AuthDialog {
  private readonly auth = inject(AuthService);
  private readonly dialogRef = inject(MatDialogRef<AuthDialog, boolean>);
  /** Online: a conta é do servidor e vale em qualquer computador. */
  readonly online = inject(APP_MODE) === 'online';
  /** Tamanho mínimo da senha nova no modo em uso (o servidor confere de novo). */
  readonly minPassword = this.auth.minPasswordLength;

  // --- Estado --------------------------------------------------------------
  readonly modes: { id: AuthMode; label: string }[] = [
    { id: 'login', label: 'Entrar' },
    { id: 'register', label: 'Criar conta' },
  ];
  readonly mode = signal<AuthMode>(inject<AuthMode>(MAT_DIALOG_DATA) ?? 'login');
  readonly loading = signal(false);
  readonly error = signal('');
  readonly showPassword = signal(false);

  // --- Formulário ----------------------------------------------------------
  readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(40)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(this.minPassword), Validators.maxLength(128)]],
  });

  constructor() {
    this.applyMode(this.mode());
  }

  /** Abre o diálogo e retorna se o usuário terminou autenticado. */
  static open(dialog: MatDialog, mode: AuthMode = 'login') {
    return dialog.open<AuthDialog, AuthMode, boolean>(AuthDialog, {
      data: mode,
      width: '420px',
      maxWidth: '94vw',
      autoFocus: 'first-tabbable',
    });
  }

  // --- Ações ---------------------------------------------------------------

  /** Alterna entre "Entrar" e "Criar conta". */
  switchMode(mode: AuthMode): void {
    this.mode.set(mode);
    this.error.set('');
    this.applyMode(mode);
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const { name, email, password } = this.form.getRawValue();
    this.loading.set(true);
    this.error.set('');

    try {
      if (this.mode() === 'register') await this.auth.register(name, email, password);
      else await this.auth.login(email, password);
      this.dialogRef.close(true);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Algo deu errado. Tente novamente.');
    } finally {
      this.loading.set(false);
    }
  }

  /** O campo "nome" só participa da validação no cadastro. */
  private applyMode(mode: AuthMode): void {
    const name = this.form.controls.name;
    if (mode === 'register') name.enable();
    else name.disable();
  }
}
