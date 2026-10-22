import { DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { APP_MODE } from '../../core/config/app-mode';
import { GameTable } from '../../core/models/game-table.model';
import { AuthService } from '../../core/services/auth.service';
import { GameTablesService } from '../../core/services/game-tables.service';
import { TableMembersService } from '../../core/services/table-members.service';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { QuickActionsService } from '../../shared/services/quick-actions.service';
import { JoinDialog } from './join-dialog/join-dialog';
import { PlayersDialog } from './players-dialog/players-dialog';

/**
 * Página "Minhas mesas": lista, cria e exclui mesas da conta. No modo online, mostra também as
 * mesas em que a conta joga, com convites (o mestre gera; quem recebe "entra com convite") e
 * "sair da mesa" para o jogador.
 */
@Component({
  selector: 'app-tables',
  imports: [DatePipe, RouterLink, MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule, EmptyState],
  templateUrl: './tables.html',
})
export class Tables {
  readonly auth = inject(AuthService);
  readonly service = inject(GameTablesService);
  readonly actions = inject(QuickActionsService);
  /** Online: mesas de outras contas, convites e jogadores. */
  readonly online = inject(APP_MODE) === 'online';
  private readonly members = inject(TableMembersService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  async remove(table: GameTable): Promise<void> {
    if (!confirm(`Excluir a mesa "${table.name}"? Esta ação não pode ser desfeita.`)) return;
    await this.attempt(() => this.service.remove(table.id), 'Mesa excluída.');
  }

  /** Mestre: jogadores da mesa e códigos de convite. */
  openPlayers(table: GameTable): void {
    PlayersDialog.open(this.dialog, table);
  }

  /** Entra numa mesa de outra pessoa com o código recebido. */
  async join(): Promise<void> {
    const table = await firstValueFrom(JoinDialog.open(this.dialog).afterClosed());
    if (table) this.snackBar.open(`Você entrou na mesa "${table.name}"!`);
  }

  /** Jogador sai da mesa (volta com um convite novo do mestre). */
  async leave(table: GameTable): Promise<void> {
    const user = this.auth.user();
    if (!user || !confirm(`Sair da mesa "${table.name}"? Para voltar, peça um convite novo ao mestre.`)) return;
    await this.attempt(async () => {
      await this.members.remove(table.id, user.id);
      await this.service.reload();
    }, 'Você saiu da mesa.');
  }

  /** Executa a ação e avisa o resultado (ou o erro, ex.: servidor fora do ar). */
  private async attempt(action: () => Promise<void>, done: string): Promise<void> {
    try {
      await action();
      this.snackBar.open(done);
    } catch (err) {
      this.snackBar.open(err instanceof Error ? err.message : 'Algo deu errado. Tente novamente.', undefined, { duration: 5000 });
    }
  }
}
