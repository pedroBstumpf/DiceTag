import { Injectable, inject, signal } from '@angular/core';
import { User } from '../models/user.model';
import { ServerApiService, ServerError } from './server-api.service';

/**
 * Conta no servidor (sessão real, cookie HttpOnly), separada da conta local do `AuthService`.
 *
 * As telas continuam usando a conta local; esta só vale para as **mesas online**. O token de
 * sessão nunca chega ao JavaScript: aqui só há os dados públicos da conta (`User`).
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

  /** Endereço que baixa os dados da conta (LGPD): o navegador baixa o arquivo com o cookie. */
  readonly exportUrl = '/api/auth/me/export';

  // --- Ações ---------------------------------------------------------------

  /** Confere se o cookie ainda vale (ao abrir a página de mesas). */
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

  async register(name: string, email: string, password: string): Promise<void> {
    const { user } = await this.api.post<{ user: User }>('/auth/register', { name: name.trim(), email: email.trim(), password });
    this.user.set(user);
    this.error.set('');
  }

  async logout(): Promise<void> {
    await this.api.post('/auth/logout');
    this.user.set(null);
  }

  /** Exclui a conta do servidor e tudo o que é dela (pede a senha de novo). */
  async deleteAccount(password: string): Promise<void> {
    await this.api.delete('/auth/me', { password });
    this.user.set(null);
  }
}
