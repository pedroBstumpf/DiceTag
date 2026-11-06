import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router, RouterLink } from '@angular/router';
import { OnlineTablesService } from '../../../core/services/online-tables.service';
import { InviteInfo, ServerAccountService } from '../../../core/services/server-account.service';

/** Lê o código do fragmento da URL (`#codigo=…`) e o tira da barra de endereço e do histórico. */
function takeCodeFromUrl(): string {
  const code = new URLSearchParams(location.hash.slice(1)).get('codigo') ?? '';
  if (location.hash) history.replaceState(null, '', location.pathname);
  return code;
}

/** Mesmo mínimo do servidor (o resto das regras da senha é conferido lá). */
const MIN_PASSWORD = 8;

/**
 * Página aberta pelo link de convite. O código vem no fragmento da URL (não vai ao servidor nem a
 * logs) e é de uso único. Antes de mostrar o formulário, pergunta ao servidor o que ele é:
 * - convite novo: a pessoa escolhe o nome que os outros vão ver e uma senha (com eles, entra depois
 *   de qualquer aparelho, em Entrar); quem já tem conta neste navegador só entra na mesa;
 * - link de retorno (gerado pelo mestre): a conta já existe; a pessoa define uma senha nova (e um
 *   nome novo, se o dela já é de outra conta).
 */
@Component({
  selector: 'app-invite',
  imports: [RouterLink, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressSpinnerModule],
  templateUrl: './invite.html',
  host: { class: 'flex min-h-dvh items-center justify-center p-6' },
})
export class Invite {
  readonly account = inject(ServerAccountService);
  private readonly tables = inject(OnlineTablesService);
  private readonly router = inject(Router);

  /** Veio no link; sem ele, a pessoa cola o código que recebeu. */
  readonly code = signal(takeCodeFromUrl());
  readonly fromLink = !!this.code();
  /** O que o código é (null = ainda não conferido). */
  readonly info = signal<InviteInfo | null>(null);
  readonly name = signal('');
  readonly password = signal('');
  readonly repeat = signal('');
  readonly showPassword = signal(false);
  readonly loading = signal(false);
  readonly error = signal('');

  constructor() {
    void this.account.ensureChecked();
    if (this.fromLink) void this.check();
  }

  // --- Ações ---------------------------------------------------------------

  /** Pergunta ao servidor o que o código é (convite novo ou link de retorno). */
  async check(): Promise<void> {
    const code = this.code().trim();
    if (!code) return;
    this.loading.set(true);
    this.error.set('');
    try {
      this.info.set(await this.account.inviteInfo(code));
    } catch (e) {
      this.info.set(null);
      this.error.set(e instanceof Error ? e.message : 'Convite inválido. Peça outro a quem te convidou.');
    } finally {
      this.loading.set(false);
    }
  }

  /** O formulário pede nome e senha (convite novo, sem conta neste navegador)? */
  needsAccount(): boolean {
    return this.info()?.kind === 'new' && !this.account.user();
  }

  /** O link de retorno pede um nome novo (o atual já é de outra conta)? */
  needsNewName(): boolean {
    const info = this.info();
    return info?.kind === 'return' && info.nameTaken;
  }

  /** Nome da conta do link de retorno (vazio no convite novo). */
  returningName(): string {
    const info = this.info();
    return info?.kind === 'return' ? info.name : '';
  }

  /** Entra na mesa, criando a conta, só entrando (já logado) ou definindo a senha nova. */
  async enter(): Promise<void> {
    const info = this.info();
    const code = this.code().trim();
    if (!info || !code) return;
    const asksPassword = info.kind === 'return' || this.needsAccount();
    const problem = asksPassword ? this.passwordProblem() : '';
    if (problem) {
      this.error.set(problem);
      return;
    }
    this.loading.set(true);
    this.error.set('');
    try {
      const name = this.name().trim();
      const table =
        info.kind === 'return'
          ? await this.account.redeem(code, { password: this.password(), ...(info.nameTaken && { name }) })
          : this.account.user()
            ? await this.tables.accept(code)
            : await this.account.redeem(code, { name, password: this.password() });
      await this.router.navigate(['/mesa-online', table.id]);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Não foi possível entrar. Peça outro convite.');
    } finally {
      this.loading.set(false);
    }
  }

  // --- Internos ------------------------------------------------------------

  /** Confere o formulário antes de enviar (sem ir ao servidor). */
  private passwordProblem(): string {
    if ((this.needsAccount() || this.needsNewName()) && !this.name().trim()) return 'Escolha o nome que os outros vão ver.';
    if (this.name().includes('@')) return 'Escolha um nome sem @.';
    if (this.password().length < MIN_PASSWORD) return `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`;
    if (this.password() !== this.repeat()) return 'As senhas não conferem.';
    return '';
  }
}
