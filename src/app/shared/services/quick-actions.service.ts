import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { readAppMode } from '../../core/config/app-mode';
import { AuthService } from '../../core/services/auth.service';
import type { AuthMode } from '../../features/auth/auth-dialog/auth-dialog';

/**
 * Ações rápidas reutilizadas pela barra lateral e pela página inicial
 * (escolher o modo, entrar, criar conta, criar mesa, abrir o worldbuild).
 * Centraliza a regra "precisa estar logado" num único lugar.
 *
 * Os diálogos são carregados só quando abrem (`import()`): os formulários do Material não
 * pesam no carregamento inicial do app.
 */
@Injectable({ providedIn: 'root' })
export class QuickActionsService {
  private readonly dialog = inject(MatDialog);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);

  /**
   * Escolha entre online e offline (`ModeDialog`). Na primeira vez é obrigatória; depois, o menu
   * da conta a abre para trocar (trocar recarrega o app).
   */
  async chooseMode(firstTime = false): Promise<void> {
    const { ModeDialog } = await import('../../features/auth/mode-dialog/mode-dialog');
    await firstValueFrom(ModeDialog.open(this.dialog, { firstTime }).afterClosed());
  }

  /** Na primeira abertura neste navegador, pergunta o modo antes de tudo. */
  async ensureModeChosen(): Promise<void> {
    if (!readAppMode()) await this.chooseMode(true);
  }

  /** Abre o diálogo de login/cadastro. Retorna true se autenticou. */
  async openAuth(mode: AuthMode = 'login'): Promise<boolean> {
    const { AuthDialog } = await import('../../features/auth/auth-dialog/auth-dialog');
    const ok = await firstValueFrom(AuthDialog.open(this.dialog, mode).afterClosed());
    if (ok) this.snackBar.open(`Olá, ${this.auth.user()?.name}! 🎲`);
    return !!ok;
  }

  /** Garante um usuário logado, pedindo login se necessário. */
  async ensureAuth(): Promise<boolean> {
    return this.auth.isLoggedIn() || this.openAuth('register');
  }

  /** Fluxo completo de criação de mesa. */
  async createTable(): Promise<void> {
    if (!(await this.ensureAuth())) return;

    const { CreateTableDialog } = await import('../../features/tables/create-table-dialog/create-table-dialog');
    const table = await firstValueFrom(CreateTableDialog.open(this.dialog).afterClosed());
    if (!table) return;

    this.snackBar.open(`Mesa "${table.name}" criada!`);
    this.router.navigate(['/mesas']);
  }

  /** Abre o worldbuild (pede login antes, se necessário). */
  async openWorldbuild(): Promise<void> {
    if (await this.ensureAuth()) this.router.navigate(['/worldbuild']);
  }
}
