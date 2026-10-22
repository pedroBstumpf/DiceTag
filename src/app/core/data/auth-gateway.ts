import { Injectable, inject } from '@angular/core';
import { APP_MODE } from '../config/app-mode';
import { User } from '../models/user.model';
import { LocalAuthGateway } from './local/local-auth.gateway';
import { ServerAuthGateway } from './server/server-auth.gateway';

/**
 * Contas e sessão (SPEC.md §2). O `AuthService` usa só esta interface; a implementação vem do
 * modo do app (`APP_MODE`): `LocalAuthGateway` (contas no IndexedDB, provisório) ou
 * `ServerAuthGateway` (contas reais no servidor, sessão por cookie HttpOnly).
 */
@Injectable({
  providedIn: 'root',
  useFactory: () => (inject(APP_MODE) === 'online' ? inject(ServerAuthGateway) : inject(LocalAuthGateway)),
})
export abstract class AuthGateway {
  /** Tamanho mínimo da senha nova (offline 6, servidor 8). */
  abstract readonly minPasswordLength: number;
  /** Aceita o visitante sem conta? (só offline, com `requireAuth = false`) */
  abstract readonly allowsGuest: boolean;

  /** Conta da sessão guardada, ao abrir o app (null = ninguém logado). */
  abstract restore(): Promise<User | null>;
  abstract login(email: string, password: string): Promise<User>;
  abstract register(name: string, email: string, password: string): Promise<User>;
  abstract logout(): Promise<void>;
  /** Sair de todos os dispositivos (offline é o mesmo que sair: só há este navegador). */
  abstract logoutAll(): Promise<void>;
}
