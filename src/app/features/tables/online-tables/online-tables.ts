import { DatePipe } from '@angular/common';
import { Component, effect, inject, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { TABLE_ACCENTS } from '../../../core/models/game-table.model';
import { OnlineTable, OnlineTablesService, TableInvite, TableMember } from '../../../core/services/online-tables.service';
import { World } from '../../../core/models/world.model';
import { ServerAccountService, shortAccountId } from '../../../core/services/server-account.service';
import { WorldImportService } from '../../../core/services/world-import.service';
import { WorldsService } from '../../../core/services/worlds.service';
import { EmptyState } from '../../../shared/components/empty-state/empty-state';

/**
 * Seção "Mesas online" da página Minhas mesas: a conta (sair, baixar os dados e excluir: LGPD) e as
 * mesas dela. O dono cria mesas, gera convites de uso único, vê quem participa, gera links de retorno
 * e tira jogadores; o convidado vê as mesas dele e pode sair delas.
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
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);

  // --- Excluir a conta (pede a senha) --------------------------------------
  readonly deleting = signal(false);
  readonly deletePassword = signal('');
  readonly busy = signal(false);

  // --- Formulários rápidos -------------------------------------------------
  readonly newName = signal('');
  /** Convites gerados nesta visita (id da mesa → código): o código só é mostrado uma vez. */
  readonly invites = signal<Record<string, TableInvite>>({});
  /** Mesa com a lista de jogadores aberta, e quem participa dela. */
  readonly membersOf = signal<string | null>(null);
  readonly members = signal<TableMember[]>([]);
  readonly shortId = shortAccountId;
  /** O link aponta só para este computador: a mesa ainda não está na internet. */
  localOnly(invite: TableInvite): boolean {
    return /\/\/(localhost|127\.0\.0\.1)[:/]/.test(invite.link);
  }

  constructor() {
    void this.account.ensureChecked();
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
      await navigator.clipboard.writeText(invite.link);
      this.snackBar.open('Link copiado. Envie só a quem você convidou: ele vale uma vez.');
    } catch {
      this.snackBar.open('Não foi possível copiar: selecione o código e copie à mão.');
    }
  }

  /** Abre ou fecha a lista de jogadores da mesa. */
  async toggleMembers(table: OnlineTable): Promise<void> {
    if (this.membersOf() === table.id) {
      this.membersOf.set(null);
      return;
    }
    await this.run(async () => {
      this.members.set(await this.service.members(table.id));
      this.membersOf.set(table.id);
    });
  }

  /** Link de retorno: o convidado trocou de aparelho ou limpou o navegador. Fica no lugar do convite. */
  async accessLink(table: OnlineTable, member: TableMember): Promise<void> {
    await this.run(async () => {
      const invite = await this.service.accessLink(table.id, member.userId);
      this.invites.update((all) => ({ ...all, [table.id]: invite }));
      this.snackBar.open(`Link de retorno de ${member.name} gerado.`);
    });
  }

  async removeMember(table: OnlineTable, member: TableMember): Promise<void> {
    if (!confirm(`Tirar ${member.name} da mesa "${table.name}"? A pessoa perde o acesso. As fichas dela continuam na mesa.`)) return;
    const done = await this.run(() => this.service.removeMember(table.id, member.userId), `${member.name} saiu da mesa.`);
    if (done) this.members.update((list) => list.filter((m) => m.userId !== member.userId));
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

  async logout(): Promise<void> {
    if (await this.run(() => this.account.logout())) await this.router.navigate(['/entrar']);
  }

  /** O dono confirma com a senha; o convidado não tem senha. */
  async deleteAccount(): Promise<void> {
    const owner = this.account.isOwner();
    const password = this.deletePassword();
    if (owner && !password) return;
    const question = owner ? 'Excluir a sua conta e todas as mesas dela? Esta ação não pode ser desfeita.' : 'Excluir a sua conta? As suas fichas saem das mesas. Para voltar, será preciso um novo convite.';
    if (!confirm(question)) return;
    const done = await this.run(() => this.account.deleteAccount(owner ? password : undefined), 'Conta excluída.');
    if (done) {
      this.cancelDelete();
      await this.router.navigate(['/entrar']);
    }
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
