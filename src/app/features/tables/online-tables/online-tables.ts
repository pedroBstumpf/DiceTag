import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { ServerAccountService } from '../../../core/services/server-account.service';
import { EmptyState } from '../../../shared/components/empty-state/empty-state';
import { AuthDialog, AuthMode } from '../../auth/auth-dialog/auth-dialog';

/**
 * Seção "Mesas online" da página Minhas mesas: a conta do servidor (entrar, criar conta, sair,
 * baixar os dados e excluir a conta — LGPD). As mesas locais continuam acima, sem mudança.
 */
@Component({
  selector: 'app-online-tables',
  imports: [MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatMenuModule, MatProgressSpinnerModule, EmptyState],
  templateUrl: './online-tables.html',
})
export class OnlineTables {
  readonly account = inject(ServerAccountService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  // --- Excluir a conta (pede a senha) --------------------------------------
  readonly deleting = signal(false);
  readonly deletePassword = signal('');
  readonly busy = signal(false);

  constructor() {
    void this.account.refresh();
  }

  // --- Conta ---------------------------------------------------------------

  async openAuth(mode: AuthMode): Promise<void> {
    const ok = await firstValueFrom(AuthDialog.open(this.dialog, mode, true).afterClosed());
    if (ok) this.snackBar.open(`Conectado ao servidor como ${this.account.user()?.name}.`);
  }

  async logout(): Promise<void> {
    await this.run(() => this.account.logout(), 'Você saiu do servidor.');
  }

  async deleteAccount(): Promise<void> {
    const password = this.deletePassword();
    if (!password || !confirm('Excluir a conta do servidor e todas as mesas dela? Esta ação não pode ser desfeita.')) return;
    const done = await this.run(() => this.account.deleteAccount(password), 'Conta do servidor excluída.');
    if (done) this.cancelDelete();
  }

  cancelDelete(): void {
    this.deleting.set(false);
    this.deletePassword.set('');
  }

  // --- Internos ------------------------------------------------------------

  /** Executa uma chamada ao servidor mostrando o erro (se houver) num aviso. */
  private async run(call: () => Promise<unknown>, success: string): Promise<boolean> {
    this.busy.set(true);
    try {
      await call();
      this.snackBar.open(success);
      return true;
    } catch (e) {
      this.snackBar.open(e instanceof Error ? e.message : 'Algo deu errado.', undefined, { duration: 5000 });
      return false;
    } finally {
      this.busy.set(false);
    }
  }
}
