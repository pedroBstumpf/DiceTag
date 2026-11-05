import { DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { GameTable } from '../../core/models/game-table.model';
import { BrowserCopyService } from '../../core/services/browser-copy.service';
import { ServerAccountService } from '../../core/services/server-account.service';
import { GameTablesService } from '../../core/services/game-tables.service';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { QuickActionsService } from '../../shared/services/quick-actions.service';
import { HostPanel } from './host-panel/host-panel';
import { OnlineTables } from './online-tables/online-tables';

/** Página "Minhas mesas": lista, cria e exclui mesas do usuário; abaixo, as mesas online (servidor). */
@Component({
  selector: 'app-tables',
  imports: [DatePipe, RouterLink, MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule, EmptyState, OnlineTables, HostPanel],
  templateUrl: './tables.html',
})
export class Tables {
  readonly account = inject(ServerAccountService);
  readonly service = inject(GameTablesService);
  readonly actions = inject(QuickActionsService);
  readonly copies = inject(BrowserCopyService);
  private readonly snackBar = inject(MatSnackBar);

  /** Baixa um arquivo com mundos, mesas e imagens deste navegador. Nada é apagado nem alterado. */
  async saveCopy(): Promise<void> {
    try {
      await this.copies.save();
      this.snackBar.open('Cópia salva na pasta de downloads.', undefined, { duration: 5000 });
    } catch (e) {
      this.snackBar.open(e instanceof Error ? e.message : 'Não foi possível salvar a cópia.', undefined, { duration: 6000 });
    }
  }

  async remove(table: GameTable): Promise<void> {
    if (!confirm(`Excluir a mesa "${table.name}"? Esta ação não pode ser desfeita.`)) return;
    await this.service.remove(table.id);
    this.snackBar.open('Mesa excluída.');
  }
}
