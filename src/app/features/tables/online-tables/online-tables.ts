import { DatePipe } from '@angular/common';
import { Component, effect, inject, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { TABLE_ACCENTS } from '../../../core/models/game-table.model';
import { OnlineTable, OnlineTablesService, TableInvite } from '../../../core/services/online-tables.service';
import { World } from '../../../core/models/world.model';
import { ServerAccountService } from '../../../core/services/server-account.service';
import { WorldImportService } from '../../../core/services/world-import.service';
import { WorldsService } from '../../../core/services/worlds.service';
import { EmptyState } from '../../../shared/components/empty-state/empty-state';
import { AuthDialog, AuthMode } from '../../auth/auth-dialog/auth-dialog';

/**
 * Seção "Mesas online" da página Minhas mesas: a conta do servidor (entrar, criar conta, sair,
 * baixar os dados e excluir a conta — LGPD) e as mesas dela (criar, convidar, entrar com
 * convite, sair, excluir). As mesas locais continuam acima, sem mudança.
 */
@Component({
  selector: 'app-online-tables',
  imports: [DatePipe, RouterLink, MatButtonModule, MatTooltipModule, MatFormFieldModule, MatIconModule, MatInputModule, MatMenuModule, MatProgressSpinnerModule, EmptyState],
  templateUrl: './online-tables.html',
})
export class OnlineTables {
  readonly account = inject(ServerAccountService);
  readonly service = inject(OnlineTablesService);
  readonly worlds = inject(WorldsService);
  readonly importer = inject(WorldImportService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  // --- Excluir a conta (pede a senha) --------------------------------------
  readonly deleting = signal(false);
  readonly deletePassword = signal('');
  readonly busy = signal(false);

  // --- Formulários rápidos -------------------------------------------------
  readonly newName = signal('');
  readonly inviteCode = signal('');
  /** Convites gerados nesta visita (id da mesa → código): o código só é mostrado uma vez. */
  readonly invites = signal<Record<string, TableInvite>>({});

  constructor() {
    void this.account.refresh();
    // Conta do servidor mudou (entrou, saiu, excluiu): recarrega ou esquece a lista
    effect(() => {
      const user = this.account.user();
      untracked(() => (user ? this.run(() => this.service.load()) : this.service.clear()));
    });
  }

  // --- Mesas ---------------------------------------------------------------

  async create(): Promise<void> {
    const name = this.newName().trim();
    if (!name) return;
    const created = { name, system: 'Sistema próprio', description: '', maxPlayers: 5, accent: TABLE_ACCENTS[0] };
    if (await this.run(() => this.service.create(created), `Mesa online "${name}" criada.`)) this.newName.set('');
  }

  async accept(): Promise<void> {
    const code = this.inviteCode().trim();
    if (!code) return;
    if (await this.run(() => this.service.accept(code), 'Você entrou na mesa!')) this.inviteCode.set('');
  }

  async invite(table: OnlineTable): Promise<void> {
    await this.run(async () => {
      const invite = await this.service.invite(table.id);
      this.invites.update((all) => ({ ...all, [table.id]: invite }));
    });
  }

  inviteOf(table: OnlineTable): TableInvite | undefined {
    return this.invites()[table.id];
  }

  async copyInvite(table: OnlineTable): Promise<void> {
    const invite = this.inviteOf(table);
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.code);
      this.snackBar.open('Código copiado.');
    } catch {
      this.snackBar.open('Não foi possível copiar: selecione o código e copie à mão.');
    }
  }

  /** Envia um mundo deste navegador para o mundo da mesa no servidor (o local continua aqui). */
  async importWorld(table: OnlineTable, world: World): Promise<void> {
    if (!confirm(`Enviar "${world.name}" para o mundo da mesa "${table.name}"? As imagens contam na sua cota do servidor. O mundo deste navegador não muda.`)) return;
    await this.run(async () => {
      const done = await this.importer.run(world.id, table.worldId);
      const failed = done.failedItems + done.failedFiles;
      const text = `Enviados ${done.items} itens e ${done.files} imagens${failed ? `; ${failed} não foram (tipo não aceito, tamanho ou cota).` : '.'}`;
      this.snackBar.open(text, 'OK', { duration: 8000 });
    });
  }

  async remove(table: OnlineTable): Promise<void> {
    if (!confirm(`Excluir a mesa online "${table.name}"? Esta ação não pode ser desfeita.`)) return;
    await this.run(() => this.service.remove(table.id), 'Mesa excluída.');
  }

  async leave(table: OnlineTable): Promise<void> {
    const userId = this.account.user()?.id;
    if (!userId || !confirm(`Sair da mesa "${table.name}"? Você precisará de um novo convite para voltar.`)) return;
    await this.run(() => this.service.leave(table.id, userId), 'Você saiu da mesa.');
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
  private async run(call: () => Promise<unknown>, success = ''): Promise<boolean> {
    this.busy.set(true);
    try {
      await call();
      if (success) this.snackBar.open(success);
      return true;
    } catch (e) {
      this.snackBar.open(e instanceof Error ? e.message : 'Algo deu errado.', undefined, { duration: 5000 });
      return false;
    } finally {
      this.busy.set(false);
    }
  }
}
