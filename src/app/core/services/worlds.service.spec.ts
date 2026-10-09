import { TestBed } from '@angular/core/testing';
import { DEFAULT_WORLD_ID, worldbuildKey } from '../models/world.model';
import { WorldItem } from '../models/world-item.model';
import { GameTablesService } from './game-tables.service';
import { StorageService } from './storage.service';
import { WorldsService } from './worlds.service';

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

/** Espera os carregamentos assíncronos (effects + IndexedDB em memória). */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    TestBed.tick();
    await new Promise((r) => setTimeout(r));
  }
}

describe('WorldsService', () => {
  let storage: MemoryStorage;
  let worlds: WorldsService;

  beforeEach(async () => {
    localStorage.clear();
    storage = new MemoryStorage();
    TestBed.configureTestingModule({ providers: [{ provide: StorageService, useValue: storage }] });
    worlds = TestBed.inject(WorldsService);
    await settle();
  });

  it('começa com o primeiro mundo, que usa a chave do Worldbuild antigo', () => {
    expect(worlds.worlds().map((w) => w.id)).toEqual([DEFAULT_WORLD_ID]);
    expect(worlds.activeId()).toBe(DEFAULT_WORLD_ID);
    expect(worldbuildKey('u', DEFAULT_WORLD_ID)).toBe('worldbuild:u');
    expect(worldbuildKey('u', 'x')).toBe('worldbuild:u:x');
  });

  it('cria até o limite de 2 mundos e abre o novo', async () => {
    const second = await worlds.create('Mundo B');
    expect(second?.name).toBe('Mundo B');
    expect(worlds.activeId()).toBe(second?.id);
    expect(worlds.canCreate()).toBe(false);
    expect(await worlds.create()).toBeNull();
    expect(worlds.worlds().length).toBe(2);
  });

  it('não exclui o único mundo nem um mundo com mesas', async () => {
    expect(await worlds.remove(DEFAULT_WORLD_ID)).toContain('pelo menos um');
    await worlds.create('B');
    await TestBed.inject(GameTablesService).create({ name: 'Mesa', system: 'X', description: '', maxPlayers: 4, accent: '#fff' });
    await settle();
    // Mesa sem worldId se passa no primeiro mundo
    expect(await worlds.remove(DEFAULT_WORLD_ID)).toContain('mesa');
  });

  it('excluir apaga os itens e os arquivos do mundo e abre outro', async () => {
    const b = (await worlds.create('B'))!;
    const key = worldbuildKey('guest', b.id);
    const items: WorldItem[] = [{ id: 'i', type: 'image', name: 'Mapa', parentId: null, createdAt: 0, updatedAt: 0, blobId: 'blob1' }];
    storage.data.set(key, items);
    storage.data.set('blob:blob1', 'arquivo');
    expect(await worlds.remove(b.id)).toBeNull();
    expect(storage.data.has(key)).toBe(false);
    expect(storage.data.has('blob:blob1')).toBe(false);
    expect(worlds.worlds().map((w) => w.id)).toEqual([DEFAULT_WORLD_ID]);
    expect(worlds.activeId()).toBe(DEFAULT_WORLD_ID);
  });
});
