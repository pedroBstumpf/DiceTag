import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { GAME_SYSTEMS, TABLE_ACCENTS } from '../../../../core/models/game-table.model';
import { GmTableSummary } from '../../../../core/services/gm.service';
import { OnlineTablesService, TableInvite, TableMember } from '../../../../core/services/online-tables.service';
import { shortAccountId } from '../../../../core/services/server-account.service';

/** Dados editáveis da mesa (os mesmos limites do servidor: nome 1–60, sistema até 60, descrição até 400, 1–20 jogadores). */
interface TableForm {
  name: string;
  system: string;
  description: string;
  maxPlayers: number;
  accent: string;
}

/**
 * Cartão de uma mesa no Painel do Mestre: informações (jogadores, convites, cenas, quem está online,
 * última gravação) e as ações do mestre — abrir, convidar, jogadores, editar, cancelar convites,
 * preparar o mundo e excluir. Toda ação chama uma rota que confere o papel no servidor; ao terminar,
 * avisa a página (`changed`) para ela recarregar o resumo.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-gm-table-card',
  imports: [DatePipe, RouterLink, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatMenuModule, MatTooltipModule],
  templateUrl: './gm-table-card.html',
})
export class GmTableCard {
  private readonly tables = inject(OnlineTablesService);
  private readonly snackBar = inject(MatSnackBar);

  readonly table = input.required<GmTableSummary>();
  /** Algo mudou no servidor: a página recarrega o resumo. */
  readonly changed = output();

  protected readonly systems = GAME_SYSTEMS;
  protected readonly accents = TABLE_ACCENTS;
  protected readonly shortId = shortAccountId;
  protected readonly busy = signal(false);

  // --- Convite e jogadores --------------------------------------------------
  /** Último convite (ou link de retorno) gerado nesta visita: o código só aparece uma vez. */
  protected readonly invite = signal<TableInvite | null>(null);
  protected readonly members = signal<TableMember[] | null>(null);
  protected readonly players = computed(() => (this.members() ?? []).filter((m) => m.role === 'player'));
  /** O link aponta para este computador: a mesa ainda não está aberta na internet. */
  protected readonly inviteIsLocal = computed(() => /\/\/(localhost|127\.0\.0\.1)[:/]/.test(this.invite()?.link ?? ''));

  // --- Edição -----------------------------------------------------------------
  protected readonly form = signal<TableForm | null>(null);

  // --- Mesa -----------------------------------------------------------------

  protected async createInvite(): Promise<void> {
    await this.run(async () => this.invite.set(await this.tables.invite(this.table().id)));
  }

  protected async copyInvite(): Promise<void> {
    const link = this.invite()?.link;
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      this.snackBar.open('Link copiado. Envie só a quem você convidou: ele vale uma vez.');
    } catch {
      this.snackBar.open('Não foi possível copiar: selecione o link e copie à mão.');
    }
  }

  protected async revokeInvites(): Promise<void> {
    const t = this.table();
    if (!confirm(`Cancelar os convites ainda não usados da mesa "${t.name}"? Os links já enviados deixam de valer.`)) return;
    if (await this.run(() => this.tables.revokeInvites(t.id), 'Convites cancelados.')) this.invite.set(null);
  }

  /** Abre ou fecha a lista de jogadores. */
  protected async toggleMembers(): Promise<void> {
    if (this.members()) {
      this.members.set(null);
      return;
    }
    await this.run(async () => this.members.set(await this.tables.members(this.table().id)), '', false);
  }

  protected async accessLink(member: TableMember): Promise<void> {
    await this.run(async () => this.invite.set(await this.tables.accessLink(this.table().id, member.userId)), `Link de retorno de ${member.name} gerado.`, false);
  }

  protected async removeMember(member: TableMember): Promise<void> {
    if (!confirm(`Tirar ${member.name} da mesa "${this.table().name}"? A pessoa perde o acesso. As fichas dela continuam na mesa.`)) return;
    if (await this.run(() => this.tables.removeMember(this.table().id, member.userId), `${member.name} saiu da mesa.`)) {
      this.members.update((list) => list?.filter((m) => m.userId !== member.userId) ?? null);
    }
  }

  protected async remove(): Promise<void> {
    const t = this.table();
    if (!confirm(`Excluir a mesa "${t.name}"? Cenas, fichas, chat e arquivos dela são apagados. Esta ação não pode ser desfeita.`)) return;
    await this.run(() => this.tables.remove(t.id), `Mesa "${t.name}" excluída.`);
  }

  // --- Edição -----------------------------------------------------------------

  protected startEdit(): void {
    const { name, system, description, maxPlayers, accent } = this.table();
    this.form.set({ name, system, description, maxPlayers, accent });
  }

  protected setField<K extends keyof TableForm>(key: K, value: TableForm[K]): void {
    this.form.update((f) => (f ? { ...f, [key]: value } : f));
  }

  protected numberOf(event: Event): number {
    return Number((event.target as HTMLInputElement).value);
  }

  protected textOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  protected canSave(): boolean {
    const f = this.form();
    return !!f && f.name.trim().length > 0 && Number.isInteger(f.maxPlayers) && f.maxPlayers >= 1 && f.maxPlayers <= 20;
  }

  protected async save(): Promise<void> {
    const f = this.form();
    if (!f || !this.canSave()) return;
    const patch = { ...f, name: f.name.trim(), system: f.system.trim(), description: f.description.trim() };
    if (await this.run(() => this.tables.update(this.table().id, patch), 'Mesa atualizada.')) this.form.set(null);
  }

  // --- Internos -------------------------------------------------------------

  /** Executa uma chamada ao servidor com aviso de erro; `reload` pede à página um resumo novo. */
  private async run(call: () => Promise<unknown>, success = '', reload = true): Promise<boolean> {
    this.busy.set(true);
    try {
      await call();
      if (success) this.snackBar.open(success);
      if (reload) this.changed.emit();
      return true;
    } catch (e) {
      this.snackBar.open(e instanceof Error ? e.message : 'Algo deu errado.', undefined, { duration: 5000 });
      return false;
    } finally {
      this.busy.set(false);
    }
  }
}
