import { Injectable, computed, inject, signal } from '@angular/core';
import { User } from '../models/user.model';
import type { OnlineTable } from './online-tables.service';
import { ServerApiService, ServerError } from './server-api.service';

/**
 * A conta do app (sessão real, cookie HttpOnly): o dono, que entra com senha, ou um convidado, que
 * entra por um link de convite só com o nome. Não há cadastro. O token de sessão nunca chega ao
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

  async login(email: string, password: string): Promise<void> {
    const { user } = await this.api.post<{ user: User }>('/auth/login', { email: email.trim(), password });
    this.user.set(user);
    this.error.set('');
  }

  /** Entra por um convite (só com o nome ou, no link de retorno, na conta que já existe). */
  async redeem(code: string, name?: string): Promise<OnlineTable> {
    const { user, table } = await this.api.post<{ user: User; table: OnlineTable }>('/invites/redeem', { code, ...(name && { name }) });
    this.user.set(user);
    this.error.set('');
    return table;
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

  /** Exclui a conta e tudo o que é dela (o dono confirma com a senha; o convidado não tem senha). */
  async deleteAccount(password?: string): Promise<void> {
    await this.api.delete('/auth/me', password ? { password } : {});
    this.user.set(null);
  }
}

/** Id curto de uma conta (`#a1b2c3`): aparece ao lado do nome. */
export function shortAccountId(id: string): string {
  return id ? `#${id.replace(/-/g, '').slice(0, 6)}` : '';
}
