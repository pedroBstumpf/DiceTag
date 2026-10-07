import { DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { GameTable } from '../../core/models/game-table.model';
import { AuthService } from '../../core/services/auth.service';
import { GameTablesService } from '../../core/services/game-tables.service';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { QuickActionsService } from '../../shared/services/quick-actions.service';

/** Página "Minhas mesas": lista, cria e exclui mesas do usuário. */
@Component({
  selector: 'app-tables',
  imports: [DatePipe, RouterLink, MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule, EmptyState],
  templateUrl: './tables.html',
})
export class Tables {
  readonly auth = inject(AuthService);
  readonly service = inject(GameTablesService);
  readonly actions = inject(QuickActionsService);
  private readonly snackBar = inject(MatSnackBar);

  async remove(table: GameTable): Promise<void> {
    if (!confirm(`Excluir a mesa "${table.name}"? Esta ação não pode ser desfeita.`)) return;
    await this.service.remove(table.id);
    this.snackBar.open('Mesa excluída.');
  }
}
