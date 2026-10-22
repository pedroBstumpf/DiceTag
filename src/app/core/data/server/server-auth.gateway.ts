import { Injectable, inject } from '@angular/core';
import { ApiClient, ApiError } from '../../api/api-client';
import { User } from '../../models/user.model';
import type { AuthGateway } from '../auth-gateway';

/**
 * Contas do modo online: as do servidor (`/api/auth`).
 *
 * A sessão é um cookie HttpOnly gravado pelo servidor; o app nunca vê o token. Senha nova com 8
 * a 128 caracteres e sem as mais comuns (o servidor confere e explica o motivo da recusa).
 */
@Injectable({ providedIn: 'root' })
export class ServerAuthGateway implements AuthGateway {
  private readonly api = inject(ApiClient);

  readonly minPasswordLength = 8;
  readonly allowsGuest = false;

  async restore(): Promise<User | null> {
    try {
      return (await this.api.get<{ user: User }>('/auth/me')).user;
    } catch (err) {
      // 401 = ninguém logado; servidor fora do ar também abre sem conta (a entrada avisa ao tentar)
      if (err instanceof ApiError) return null;
      throw err;
    }
  }

  async login(email: string, password: string): Promise<User> {
    return (await this.api.post<{ user: User }>('/auth/login', { email, password })).user;
  }

  async register(name: string, email: string, password: string): Promise<User> {
    return (await this.api.post<{ user: User }>('/auth/register', { name, email, password })).user;
  }

  async logout(): Promise<void> {
    await this.api.post('/auth/logout');
  }

  async logoutAll(): Promise<void> {
    await this.api.post('/auth/logout-all');
  }
}
