import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiClient } from '../api/api-client';
import { AuthGateway } from '../data/auth-gateway';
import { User } from '../models/user.model';

/** Usuário usado no modo de teste offline (sem exigência de conta). */
const GUEST_USER: User = { id: 'guest', name: 'Visitante', email: 'modo de teste', createdAt: 0 };

/**
 * Conta de quem usa o app, igual nos dois modos (offline e online).
 *
 * As operações vão para o `AuthGateway` do modo em uso: contas locais no IndexedDB (offline)
 * ou contas do servidor, com sessão por cookie (online). Offline, sem ninguém logado, entra o
 * visitante (`APP_SETTINGS.requireAuth = false`); online não há visitante.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly gateway = inject(AuthGateway);

  // --- Estado --------------------------------------------------------------
  private readonly _user = signal<User | null>(null);
  /** Usuário atual: a conta logada ou, no modo de teste offline, o visitante. */
  readonly user = computed(() => this._user() ?? (this.gateway.allowsGuest ? GUEST_USER : null));
  /** Há alguém usando o app (conta real ou visitante)? */
  readonly isLoggedIn = computed(() => this.user() !== null);
  /** true quando é o visitante do modo de teste (sem conta real). */
  readonly isGuest = computed(() => this._user() === null && this.user() !== null);
  /** A sessão guardada já foi conferida? (online, a conta só aparece depois da resposta do servidor) */
  readonly restored = signal(false);
  /** Tamanho mínimo da senha nova no modo em uso. */
  readonly minPasswordLength = this.gateway.minPasswordLength;

  constructor() {
    void this.restoreSession();
    // Sessão vencida ou encerrada em outro dispositivo: a conta sai daqui também
    inject(ApiClient).onUnauthorized(() => {
      if (this._user()) this._user.set(null);
    });
  }

  // --- Ações públicas ------------------------------------------------------

  /** Cria uma conta e já inicia a sessão. */
  async register(name: string, email: string, password: string): Promise<void> {
    this._user.set(await this.gateway.register(name, email, password));
  }

  /** Entra com e-mail e senha. */
  async login(email: string, password: string): Promise<void> {
    this._user.set(await this.gateway.login(email, password));
  }

  /** Encerra a sessão atual. */
  async logout(): Promise<void> {
    this._user.set(null);
    await this.gateway.logout();
  }

  /** Encerra a sessão em todos os dispositivos. */
  async logoutAll(): Promise<void> {
    this._user.set(null);
    await this.gateway.logoutAll();
  }

  // --- Internos ------------------------------------------------------------

  private async restoreSession(): Promise<void> {
    try {
      const user = await this.gateway.restore();
      // Alguém entrou enquanto a sessão era conferida: vale o login mais novo
      if (user && !this._user()) this._user.set(user);
    } finally {
      this.restored.set(true);
    }
  }
}
