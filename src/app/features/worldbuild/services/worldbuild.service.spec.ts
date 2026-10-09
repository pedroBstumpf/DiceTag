import { TestBed } from '@angular/core/testing';
import { WorldItem } from '../../../core/models/world-item.model';
import { StorageService } from '../../../core/services/storage.service';
import { WorldsService } from '../../../core/services/worlds.service';
import { WorldbuildService } from './worldbuild.service';

/** IndexedDB em memória (o jsdom não tem IndexedDB). */
class MemoryStorage {
  readonly data = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined;
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
  async requestPersistence(): Promise<boolean> {
    return false;
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    TestBed.tick();
    await new Promise((r) => setTimeout(r));
  }
}

const item = (id: string, type: WorldItem['type'] = 'document', parentId: string | null = null): WorldItem => ({
  id,
  type,
  name: id,
  parentId,
  createdAt: 0,
  updatedAt: 0,
});

/** Worldbuild com mundos: carrega o mundo aberto e a mesa de trabalho dele. */
describe('WorldbuildService (mundos)', () => {
  let storage: MemoryStorage;

  function start(): { service: WorldbuildService; worlds: WorldsService } {
    TestBed.configureTestingModule({ providers: [{ provide: StorageService, useValue: storage }] });
    return { service: TestBed.inject(WorldbuildService), worlds: TestBed.inject(WorldsService) };
  }

  beforeEach(() => {
    localStorage.clear();
    storage = new MemoryStorage();
  });

  it('carrega os itens do primeiro mundo da chave antiga do Worldbuild', async () => {
    storage.data.set('worldbuild:guest', [item('meu')]);
    const { service } = start();
    await settle();
    expect(service.items().map((i) => i.id)).toEqual(['meu']);
    expect(service.loaded()).toBe(true);
  });

  it('mesa de trabalho: janelas salvas por mundo voltam ao reabrir o mundo', async () => {
    const { service, worlds } = start();
    await settle();
    const win = { id: 'doc', geometry: { x: 40, y: 60, width: 500, height: 400 }, maximized: false, minimized: true, pinned: true, z: 3 };
    service.saveDesk([win]);
    const other = (await worlds.create('B'))!;
    await settle();
    // Trocar de mundo grava a mesa do anterior e começa vazia no novo
    expect(storage.data.get('desk:guest:default')).toEqual([win]);
    expect(service.desk()).toEqual([]);
    worlds.select('default');
    await settle();
    expect(service.desk()).toEqual([win]);
    expect(storage.data.has(`desk:guest:${other.id}`)).toBe(false);
  });

  it('trocar de mundo carrega os itens do outro mundo (e grava o anterior)', async () => {
    const { service, worlds } = start();
    await settle();
    service.create('document', null, 'Doc do mundo 1');
    const second = (await worlds.create('B'))!;
    await settle();
    expect(service.items()).toEqual([]);
    expect(service.title()).toBe('B');
    service.create('race', null, 'Elfo');
    worlds.select('default');
    await settle();
    expect(service.items().map((i) => i.name)).toEqual(['Doc do mundo 1']);
    expect((storage.data.get(`worldbuild:guest:${second.id}`) as WorldItem[]).map((i) => i.name)).toEqual(['Elfo']);
  });
});
