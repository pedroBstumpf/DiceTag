import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { GameTable } from '../../../core/models/game-table.model';
import { TableInvite, TableMember, TableMembersService } from '../../../core/services/table-members.service';

/**
 * Jogadores e convites de uma mesa online (só o mestre abre): lista quem participa, remove
 * jogadores e gera o código de convite — mostrado uma vez só, para copiar e mandar aos amigos.
 */
@Component({
  selector: 'app-players-dialog',
  imports: [DatePipe, MatDialogModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule],
  templateUrl: './players-dialog.html',
})
export class PlayersDialog {
  private readonly service = inject(TableMembersService);
  readonly table = inject<GameTable>(MAT_DIALOG_DATA);

  // --- Estado --------------------------------------------------------------
  readonly members = signal<TableMember[] | null>(null);
  readonly invite = signal<TableInvite | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly copied = signal(false);
  /** Jogadores (sem contar o mestre), para mostrar quantas vagas restam. */
  readonly players = computed(() => (this.members() ?? []).filter((m) => m.role === 'player').length);

  constructor() {
    void this.load();
  }

  static open(dialog: MatDialog, table: GameTable) {
    return dialog.open<PlayersDialog, GameTable>(PlayersDialog, { data: table, width: '480px', maxWidth: '94vw' });
  }

  // --- Ações ---------------------------------------------------------------

  async generate(): Promise<void> {
    await this.run(async () => {
      this.invite.set(await this.service.createInvite(this.table.id));
      this.copied.set(false);
    });
  }

  async copy(): Promise<void> {
    const code = this.invite()?.code;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      this.copied.set(true);
    } catch {
      this.error.set('Não deu para copiar: selecione o código e copie com Ctrl+C.');
    }
  }

  /** Cancela todos os convites ainda válidos (quem já entrou continua na mesa). */
  async revoke(): Promise<void> {
    await this.run(async () => {
      await this.service.revokeInvites(this.table.id);
      this.invite.set(null);
    });
  }

  async remove(member: TableMember): Promise<void> {
    if (!confirm(`Remover ${member.name} da mesa? A pessoa sai na hora (pode voltar com um convite novo).`)) return;
    await this.run(async () => {
      await this.service.remove(this.table.id, member.userId);
      await this.load();
    });
  }

  // --- Internos ------------------------------------------------------------

  private async load(): Promise<void> {
    await this.run(async () => this.members.set(await this.service.members(this.table.id)));
  }

  /** Executa uma chamada ao servidor mostrando o andamento e o erro, se houver. */
  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await action();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Algo deu errado. Tente novamente.');
    } finally {
      this.busy.set(false);
    }
  }
}
