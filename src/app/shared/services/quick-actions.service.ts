import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

/**
 * Ações rápidas reutilizadas pela barra lateral e pela página inicial (criar mesa, abrir o worldbuild).
 * O diálogo é carregado só quando aberto: não pesa no carregamento inicial do app.
 */
@Injectable({ providedIn: 'root' })
export class QuickActionsService {
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);

  /** Fluxo completo de criação de mesa. */
  async createTable(): Promise<void> {
    const { CreateTableDialog } = await import('../../features/tables/create-table-dialog/create-table-dialog');
    const table = await firstValueFrom(CreateTableDialog.open(this.dialog).afterClosed());
    if (!table) return;

    this.snackBar.open(`Mesa "${table.name}" criada!`);
    this.router.navigate(['/mesas']);
  }

  /** Navega para uma página. */
  goTo(path: string): void {
    this.router.navigateByUrl(path);
  }

  /** Abre o worldbuild. */
  async openWorldbuild(): Promise<void> {
    this.router.navigate(['/worldbuild']);
  }
}
