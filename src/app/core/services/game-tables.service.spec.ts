import { TestBed } from '@angular/core/testing';
import { AuthGateway } from '../data/auth-gateway';
import { TablesRepository } from '../data/tables.repository';
import { GameTable, NewGameTable } from '../models/game-table.model';
import { User } from '../models/user.model';
import { AuthService } from './auth.service';
import { GameTablesService } from './game-tables.service';

const ana: User = { id: 'u-ana', name: 'Ana', email: 'ana@exemplo.com', createdAt: 0 };
const table = (id: string, createdAt: number, ownerId = 'u-ana'): GameTable => ({
  id,
  ownerId,
  name: id,
  system: '',
  description: '',
  maxPlayers: 4,
  accent: '#4f86f7',
  createdAt,
});
const data: NewGameTable = { name: 'Nova', system: '', description: '', maxPlayers: 4, accent: '#4f86f7' };

/** Repositório falso em memória (pode falhar de propósito). */
class FakeRepository implements TablesRepository {
  tables: GameTable[] = [table('antiga', 1), table('nova', 2), table('de-outro', 3, 'u-bia')];
  failing = false;
  async list() {
    if (this.failing) throw new Error('O servidor não está respondendo.');
    return [...this.tables];
  }
  async create(user: User, d: NewGameTable) {
    return { ...d, id: 'criada', ownerId: user.id, createdAt: 9 };
  }
  async remove(_user: User, id: string) {
    this.tables = this.tables.filter((t) => t.id !== id);
  }
}

/** Gateway falso: a conta já está logada ao abrir. */
const gateway: Partial<AuthGateway> = {
  minPasswordLength: 8,
  allowsGuest: false,
  restore: async () => ana,
  logout: async () => undefined,
};

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    TestBed.tick();
    await new Promise((r) => setTimeout(r));
  }
}

describe('GameTablesService', () => {
  let repository: FakeRepository;
  let service: GameTablesService;

  beforeEach(async () => {
    repository = new FakeRepository();
    TestBed.configureTestingModule({
      providers: [
        { provide: TablesRepository, useValue: repository },
        { provide: AuthGateway, useValue: gateway },
      ],
    });
    service = TestBed.inject(GameTablesService);
    await settle();
  });

  it('carrega as mesas da conta, mais recentes primeiro (inclusive as em que joga)', () => {
    expect(service.loaded()).toBe(true);
    expect(service.tables().map((t) => t.id)).toEqual(['de-outro', 'nova', 'antiga']);
    expect(service.isOwner(service.getById('nova')!)).toBe(true);
    expect(service.isOwner(service.getById('de-outro')!)).toBe(false);
  });

  it('cria e exclui pelo repositório', async () => {
    await service.create(data);
    expect(service.getById('criada')?.ownerId).toBe('u-ana');
    await service.remove('nova');
    expect(service.getById('nova')).toBeUndefined();
  });

  it('servidor fora do ar: lista vazia com o motivo; recarregar tenta de novo', async () => {
    repository.failing = true;
    await service.reload();
    expect(service.tables()).toEqual([]);
    expect(service.loadError()).toContain('não está respondendo');
    repository.failing = false;
    await service.reload();
    expect(service.loadError()).toBeNull();
    expect(service.tables().length).toBe(3);
  });

  it('sem conta, sem mesas', async () => {
    await TestBed.inject(AuthService).logout();
    await settle();
    expect(service.tables()).toEqual([]);
  });
});
