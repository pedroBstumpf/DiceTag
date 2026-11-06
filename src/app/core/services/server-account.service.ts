import { Injectable, computed, inject, signal } from '@angular/core';
import { User } from '../models/user.model';
import type { OnlineTable } from './online-tables.service';
import { ServerApiService, ServerError } from './server-api.service';

/** Código de convite: convite novo, ou link de retorno de uma conta (e se o nome dela já é de outra). */
export type InviteInfo = { kind: 'new' } | { kind: 'return'; name: string; nameTaken: boolean };

/**
 * A conta do app (sessão real, cookie HttpOnly): o dono, que entra com e-mail e senha, ou um
 * convidado, que nasce pelo link de convite (nome + senha) e depois entra pelo nome. Não há cadastro. O token de sessão nunca chega ao
 * JavaScript: aqui só há os dados públicos da conta (`User`).
 *
 * A conta local do `AuthService` continua existindo só como dona dos dados guardados neste navegador.
 */
@Injectable({ providedIn: 'root' })
export class ServerAccountService {
  private readonly api = inject(ServerApiService);

  // --- Estado --------------------------------------------------------------
  /** Conta logada no servidor (null = sem sessão ou ainda não conferido). */
  readonly user = signal<User | null>(null);
  /** Já perguntou ao servidor se há sessão? */
  readonly checked = signal(false);
  /** Erro da última conferência (ex.: servidor fora do ar). */
  readonly error = signal('');
  /** É o dono do app? */
  readonly isOwner = computed(() => this.user()?.kind === 'owner');
  /** Id curto, para diferenciar pessoas de mesmo nome na tela. */
  readonly shortId = computed(() => shortAccountId(this.user()?.id ?? ''));
  private checking: Promise<void> | null = null;

  /** Endereço que baixa os dados da conta (LGPD): o navegador baixa o arquivo com o cookie. */
  readonly exportUrl = '/api/auth/me/export';

  // --- Ações ---------------------------------------------------------------

  /** Confere a sessão uma vez só por carregamento do app (as proteções de rota esperam por isto). */
  ensureChecked(): Promise<void> {
    this.checking ??= this.refresh();
    return this.checking;
  }

  /** Confere se o cookie ainda vale. */
  async refresh(): Promise<void> {
    try {
      const { user } = await this.api.get<{ user: User }>('/auth/me');
      this.user.set(user);
      this.error.set('');
    } catch (e) {
      this.user.set(null);
      // 401 = só não há sessão; o resto (servidor fora do ar) vale avisar
      this.error.set(e instanceof ServerError && e.status !== 401 ? e.message : '');
    } finally {
      this.checked.set(true);
    }
  }

  /** Entra pelo e-mail (dono) ou pelo nome da mesa (convidado com senha). */
  async login(login: string, password: string): Promise<void> {
    const { user } = await this.api.post<{ user: User }>('/auth/login', { login: login.trim(), password });
    this.user.set(user);
    this.error.set('');
  }

  /** O que é um código de convite, sem gastá-lo: convite novo ou link de retorno (com o nome da conta). */
  inviteInfo(code: string): Promise<InviteInfo> {
    return this.api.post<InviteInfo>('/invites/info', { code });
  }

  /**
   * Entra por um convite: no novo, com o nome e a senha da conta que nasce; no link de retorno, na
   * conta que já existe, com uma senha nova (e um nome novo, se o atual já é de outra conta).
   */
  async redeem(code: string, input: { name?: string; password: string }): Promise<OnlineTable> {
    const { user, table } = await this.api.post<{ user: User; table: OnlineTable }>('/invites/redeem', { code, password: input.password, ...(input.name && { name: input.name }) });
    this.user.set(user);
    this.error.set('');
    return table;
  }

  /** Convidado antigo, sem senha, cria a dele (as outras sessões da conta caem). */
  async createPassword(password: string): Promise<void> {
    await this.api.post('/auth/password/create', { password });
    this.user.update((user) => user && { ...user, hasPassword: true });
  }

  /** Troca a senha (as outras sessões da conta caem; esta continua). */
  async changePassword(current: string, next: string): Promise<void> {
    await this.api.post('/auth/password', { current, next });
  }

  /** Troca a senha com o token do link (a pessoa entra de novo depois: as sessões caem). */
  async resetPassword(token: string, password: string): Promise<void> {
    await this.api.post('/auth/password/reset', { token, password });
    this.user.set(null);
  }

  async logout(): Promise<void> {
    await this.api.post('/auth/logout');
    this.user.set(null);
  }

  /** Exclui a conta e tudo o que é dela (quem tem senha confirma com ela). */
  async deleteAccount(password?: string): Promise<void> {
    await this.api.delete('/auth/me', password ? { password } : {});
    this.user.set(null);
  }
}

/** Id curto de uma conta (`#a1b2c3`): aparece ao lado do nome. */
export function shortAccountId(id: string): string {
  return id ? `#${id.replace(/-/g, '').slice(0, 6)}` : '';
}
