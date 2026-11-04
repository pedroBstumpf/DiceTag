import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../../core/services/auth.service';
import { ServerAccountService } from '../../../core/services/server-account.service';

export type AuthMode = 'login' | 'register';

/** Dados do diálogo: modo inicial e se a conta é a do servidor (mesas online). */
export interface AuthDialogData {
  mode: AuthMode;
  server: boolean;
}

/** Tamanho mínimo da senha: a conta local aceita 6; o servidor exige 8 (BACKEND_SECURITY.md). */
const MIN_PASSWORD = { local: 6, server: 8 };

/**
 * Diálogo único para entrar ou criar conta — local (`AuthService`) ou do servidor
 * (`ServerAccountService`, usada pelas mesas online).
 * Fecha com `true` quando o usuário termina autenticado.
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
  private readonly data = inject<AuthDialogData>(MAT_DIALOG_DATA);
  /** Onde a conta vive: as duas fontes têm `login` e `register` com a mesma assinatura. */
  private readonly accounts: Pick<AuthService, 'login' | 'register'> = this.data.server ? inject(ServerAccountService) : inject(AuthService);
  private readonly dialogRef = inject(MatDialogRef<AuthDialog, boolean>);

  // --- Estado --------------------------------------------------------------
  readonly modes: { id: AuthMode; label: string }[] = [
    { id: 'login', label: 'Entrar' },
    { id: 'register', label: 'Criar conta' },
  ];
  readonly server = this.data.server;
  readonly minPassword = this.server ? MIN_PASSWORD.server : MIN_PASSWORD.local;
  readonly mode = signal<AuthMode>(this.data.mode);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly showPassword = signal(false);

  // --- Formulário ----------------------------------------------------------
  readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(40)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(this.minPassword)]],
  });

  constructor() {
    this.applyMode(this.mode());
  }

  /** Abre o diálogo e retorna se o usuário terminou autenticado. `server`: conta do servidor. */
  static open(dialog: MatDialog, mode: AuthMode = 'login', server = false) {
    return dialog.open<AuthDialog, AuthDialogData, boolean>(AuthDialog, {
      data: { mode, server },
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
      if (this.mode() === 'register') await this.accounts.register(name, email, password);
      else await this.accounts.login(email, password);
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
