import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { WorldItemType } from '../../core/models/world-item.model';
import { AuthService } from '../../core/services/auth.service';
import { AuthDialog, AuthMode } from '../../features/auth/auth-dialog/auth-dialog';
import { CreateTableDialog } from '../../features/tables/create-table-dialog/create-table-dialog';

/**
 * Ações rápidas reutilizadas pela barra lateral e pela página inicial
 * (entrar, criar conta, criar mesa, criar itens de worldbuild).
 * Centraliza a regra "precisa estar logado" num único lugar.
 */
@Injectable({ providedIn: 'root' })
export class QuickActionsService {
  private readonly dialog = inject(MatDialog);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);

  /** Abre o diálogo de login/cadastro. Retorna true se autenticou. */
  async openAuth(mode: AuthMode = 'login'): Promise<boolean> {
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

    const table = await firstValueFrom(CreateTableDialog.open(this.dialog).afterClosed());
    if (!table) return;

    this.snackBar.open(`Mesa "${table.name}" criada!`);
    this.router.navigate(['/mesas']);
  }

  /** Navega para uma página. */
  goTo(path: string): void {
    this.router.navigateByUrl(path);
  }

  /** Abre o worldbuild (pede login antes, se necessário). */
  async openWorldbuild(): Promise<void> {
    if (await this.ensureAuth()) this.router.navigate(['/worldbuild']);
  }

  /** Abre o worldbuild já criando um item do tipo pedido. */
  async createWorldItem(type: WorldItemType): Promise<void> {
    if (!(await this.ensureAuth())) return;
    this.router.navigate(['/worldbuild'], { queryParams: { novo: type } });
  }
}
