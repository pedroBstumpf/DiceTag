import { TestBed } from '@angular/core/testing';
import { ApiClient } from '../../api/api-client';
import { User } from '../../models/user.model';
import { TableMembersService } from '../../services/table-members.service';
import { ServerTablesRepository } from './server-tables.repository';
import { ServerWorldRepository } from './server-world.repository';

const ana: User = { id: 'u-ana', name: 'Ana', email: 'ana@exemplo.com', createdAt: 0 };
const serverTable = {
  id: 't1',
  ownerId: 'u-gm',
  worldId: 'w1',
  name: 'Mesa',
  system: '',
  description: '',
  maxPlayers: 4,
  accent: '#4f86f7',
  createdAt: 1,
  role: 'player',
};

/** ApiClient falso: registra as chamadas e devolve a resposta configurada. */
class FakeApi {
  calls: { method: string; path: string; body?: unknown }[] = [];
  response: unknown = {};
  private record(method: string, path: string, body?: unknown) {
    this.calls.push({ method, path, ...(body !== undefined && { body }) });
    return Promise.resolve(this.response);
  }
  get = (path: string) => this.record('GET', path);
  post = (path: string, body?: unknown) => this.record('POST', path, body);
  patch = (path: string, body?: unknown) => this.record('PATCH', path, body);
  delete = (path: string) => this.record('DELETE', path);
}

describe('repositórios do servidor', () => {
  let api: FakeApi;

  beforeEach(() => {
    api = new FakeApi();
    TestBed.configureTestingModule({ providers: [{ provide: ApiClient, useValue: api }] });
  });

  it('mesas: lista com o papel, cria sem mundo vazio e exclui pelo id', async () => {
    const repo = TestBed.inject(ServerTablesRepository);
    api.response = { tables: [serverTable] };
    expect((await repo.list(ana))[0]).toMatchObject({ id: 't1', role: 'player', worldId: 'w1' });

    api.response = { table: { ...serverTable, role: 'gm' } };
    await repo.create(ana, { name: 'Mesa', system: '', description: '', maxPlayers: 4, accent: '#4f86f7' });
    expect(api.calls[1]).toEqual({
      method: 'POST',
      path: '/tables',
      body: { name: 'Mesa', system: '', description: '', maxPlayers: 4, accent: '#4f86f7' },
    });

    await repo.remove(ana, 't/1');
    expect(api.calls[2]).toEqual({ method: 'DELETE', path: '/tables/t%2F1' });
  });

  it('mundos: só id, nome e data chegam ao app', async () => {
    const repo = TestBed.inject(ServerWorldRepository);
    api.response = { worlds: [{ id: 'w1', ownerId: 'u-ana', name: 'Meu mundo', createdAt: 5 }] };
    expect(await repo.worlds(ana)).toEqual([{ id: 'w1', name: 'Meu mundo', createdAt: 5 }]);
    await repo.renameWorld(ana, 'w1', 'Zehenia');
    expect(api.calls[1]).toEqual({ method: 'PATCH', path: '/worlds/w1', body: { name: 'Zehenia' } });
  });

  it('convites: aceitar manda o código sem espaços e devolve a mesa', async () => {
    const members = TestBed.inject(TableMembersService);
    api.response = { table: serverTable };
    expect((await members.acceptInvite('  codigo-do-convite  ')).id).toBe('t1');
    expect(api.calls[0]).toEqual({ method: 'POST', path: '/invites/accept', body: { code: 'codigo-do-convite' } });
  });
});
