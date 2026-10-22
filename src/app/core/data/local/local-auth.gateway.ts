import { Injectable, inject } from '@angular/core';
import { APP_SETTINGS } from '../../config/app-settings';
import { StoredUser, User } from '../../models/user.model';
import { StorageService } from '../../services/storage.service';
import { newId } from '../../utils/id';
import type { AuthGateway } from '../auth-gateway';

const USERS_KEY = 'users';
// O prefixo "dicetag" (nome antigo do projeto) é mantido na sessão e no hash da senha:
// trocá-lo desconectaria todos e invalidaria as senhas já salvas.
const SESSION_KEY = 'dicetag.session';

/**
 * Contas do modo offline (provisórias, só neste navegador).
 *
 * - Contas ficam no IndexedDB com a senha em hash SHA-256.
 * - A sessão é apenas o id do usuário no localStorage.
 * Não é segurança real: o modo online usa as contas do servidor (`ServerAuthGateway`).
 */
@Injectable({ providedIn: 'root' })
export class LocalAuthGateway implements AuthGateway {
  private readonly storage = inject(StorageService);

  readonly minPasswordLength = 6;
  readonly allowsGuest = !APP_SETTINGS.requireAuth;

  async restore(): Promise<User | null> {
    const id = localStorage.getItem(SESSION_KEY);
    if (!id) return null;
    const found = (await this.loadUsers()).find((u) => u.id === id);
    return found ? this.toPublic(found) : null;
  }

  async register(name: string, email: string, password: string): Promise<User> {
    const users = await this.loadUsers();
    const normalized = email.trim().toLowerCase();
    if (users.some((u) => u.email === normalized)) {
      throw new Error('Já existe uma conta com este e-mail.');
    }
    const stored: StoredUser = {
      id: newId(),
      name: name.trim(),
      email: normalized,
      createdAt: Date.now(),
      passwordHash: await this.hash(password),
    };
    await this.storage.set(USERS_KEY, [...users, stored]);
    return this.startSession(stored);
  }

  async login(email: string, password: string): Promise<User> {
    const users = await this.loadUsers();
    const found = users.find((u) => u.email === email.trim().toLowerCase());
    if (!found || found.passwordHash !== (await this.hash(password))) {
      throw new Error('E-mail ou senha incorretos.');
    }
    return this.startSession(found);
  }

  async logout(): Promise<void> {
    localStorage.removeItem(SESSION_KEY);
  }

  logoutAll(): Promise<void> {
    return this.logout();
  }

  // --- Internos ------------------------------------------------------------

  private startSession(user: StoredUser): User {
    localStorage.setItem(SESSION_KEY, user.id);
    return this.toPublic(user);
  }

  private async loadUsers(): Promise<StoredUser[]> {
    return (await this.storage.get<StoredUser[]>(USERS_KEY)) ?? [];
  }

  /** Remove dados sensíveis antes de expor o usuário à interface. */
  private toPublic({ passwordHash: _, ...user }: StoredUser): User {
    return user;
  }

  /** SHA-256 da senha (com fallback simples fora de contexto seguro). */
  private async hash(value: string): Promise<string> {
    const data = new TextEncoder().encode(`dicetag:${value}`);
    if (globalThis.crypto?.subtle) {
      const digest = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    }
    return Array.from(data).reduce((h, b) => (Math.imul(31, h) + b) | 0, 7).toString(16);
  }
}
