import { TestBed } from '@angular/core/testing';
import { ApiClient, FETCH } from '../api/api-client';
import { AuthGateway } from '../data/auth-gateway';
import { User } from '../models/user.model';
import { AuthService } from './auth.service';

const ana: User = { id: 'u-ana', name: 'Ana', email: 'ana@exemplo.com', createdAt: 0 };

/** Gateway falso: sessão guardada configurável, login aceita qualquer senha. */
class FakeGateway implements AuthGateway {
  minPasswordLength = 8;
  saved: User | null = null;
  loggedOut = 0;
  constructor(readonly allowsGuest: boolean) {}
  async restore() {
    return this.saved;
  }
  async login() {
    return ana;
  }
  async register(name: string, email: string) {
    return { ...ana, name, email };
  }
  async logout() {
    this.loggedOut++;
  }
  async logoutAll() {
    this.loggedOut++;
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r));
}

function setup(gateway: FakeGateway, fetcher: typeof fetch = async () => ({ status: 200, ok: true, json: async () => ({}) }) as Response) {
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthGateway, useValue: gateway },
      { provide: FETCH, useValue: fetcher },
    ],
  });
  return TestBed.inject(AuthService);
}

describe('AuthService', () => {
  it('restaura a sessão guardada e marca quando terminou', async () => {
    const gateway = new FakeGateway(false);
    gateway.saved = ana;
    const auth = setup(gateway);
    expect(auth.restored()).toBe(false);
    await settle();
    expect(auth.user()).toEqual(ana);
    expect(auth.restored()).toBe(true);
  });

  it('online não há visitante: sem login, ninguém', async () => {
    const auth = setup(new FakeGateway(false));
    await settle();
    expect(auth.user()).toBeNull();
    expect(auth.isLoggedIn()).toBe(false);
  });

  it('offline, sem login, entra o visitante', async () => {
    const auth = setup(new FakeGateway(true));
    await settle();
    expect(auth.isGuest()).toBe(true);
    await auth.login('ana@exemplo.com', 'x');
    expect(auth.isGuest()).toBe(false);
    expect(auth.user()?.id).toBe('u-ana');
  });

  it('sair limpa a conta e encerra a sessão no gateway', async () => {
    const gateway = new FakeGateway(false);
    const auth = setup(gateway);
    await auth.login('ana@exemplo.com', 'x');
    await auth.logout();
    expect(auth.user()).toBeNull();
    expect(gateway.loggedOut).toBe(1);
  });

  it('401 de qualquer chamada (sessão vencida) tira a conta deste navegador', async () => {
    const auth = setup(new FakeGateway(false), async () => ({ status: 401, ok: false, json: async () => ({}) }) as Response);
    await auth.login('ana@exemplo.com', 'x');
    await expect(TestBed.inject(ApiClient).get('/tables')).rejects.toBeDefined();
    expect(auth.user()).toBeNull();
  });
});
