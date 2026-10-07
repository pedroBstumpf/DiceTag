import { Injectable, computed, inject, signal } from '@angular/core';
import { APP_SETTINGS } from '../config/app-settings';
import { StoredUser, User } from '../models/user.model';
import { newId } from '../utils/id';
import { StorageService } from './storage.service';

const USERS_KEY = 'users';
const SESSION_KEY = 'dicetag.session';

/** Usuário usado no modo de teste (sem exigência de conta). */
const GUEST_USER: User = { id: 'guest', name: 'Visitante', email: 'modo de teste', createdAt: 0 };

/**
 * Autenticação local (provisória, até existir backend).
 *
 * - Contas ficam no IndexedDB com a senha em hash SHA-256.
 * - A sessão é apenas o id do usuário no localStorage.
 * A interface pública (user, isLoggedIn, login, register, logout)
 * já é a mesma que um serviço com API real terá.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly storage = inject(StorageService);

  // --- Estado --------------------------------------------------------------
  private readonly _user = signal<User | null>(null);

  /** Usuário atual: a conta logada ou, no modo de teste, o visitante. */
  readonly user = computed(() => this._user() ?? (APP_SETTINGS.requireAuth ? null : GUEST_USER));
  /** Há alguém usando o app (conta real ou visitante)? */
  readonly isLoggedIn = computed(() => this.user() !== null);
  /** true quando é o visitante do modo de teste (sem conta real). */
  readonly isGuest = computed(() => this._user() === null && this.user() !== null);

  constructor() {
    this.restoreSession();
  }

  // --- Ações públicas ------------------------------------------------------

  /** Cria uma conta e já inicia a sessão. */
  async register(name: string, email: string, password: string): Promise<void> {
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
    this.startSession(stored);
  }

  /** Entra com e-mail e senha. */
  async login(email: string, password: string): Promise<void> {
    const users = await this.loadUsers();
    const found = users.find((u) => u.email === email.trim().toLowerCase());

    if (!found || found.passwordHash !== (await this.hash(password))) {
      throw new Error('E-mail ou senha incorretos.');
    }
    this.startSession(found);
  }

  /** Encerra a sessão atual. */
  logout(): void {
    localStorage.removeItem(SESSION_KEY);
    this._user.set(null);
  }

  // --- Internos ------------------------------------------------------------

  private async restoreSession(): Promise<void> {
    const id = localStorage.getItem(SESSION_KEY);
    if (!id) return;
    const found = (await this.loadUsers()).find((u) => u.id === id);
    if (found) this._user.set(this.toPublic(found));
  }

  private startSession(user: StoredUser): void {
    localStorage.setItem(SESSION_KEY, user.id);
    this._user.set(this.toPublic(user));
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
