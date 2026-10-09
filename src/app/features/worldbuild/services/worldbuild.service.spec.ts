import { TestBed } from '@angular/core/testing';
import { WorldItem } from '../../../core/models/world-item.model';
import { StorageService } from '../../../core/services/storage.service';
import { WorldsService } from '../../../core/services/worlds.service';
import { LEGACY_LORE_FOLDER, LEGACY_LORE_IMPORTED_KEY, LEGACY_LORE_KEY } from '../utils/legacy-lore';
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

/**
 * Worldbuild com mundos: carrega o mundo aberto e, no primeiro mundo, importa a antiga Lore geral
 * uma única vez (com os mesmos ids), sem apagar a chave antiga.
 */
describe('WorldbuildService (mundos e importação da Lore geral)', () => {
  let storage: MemoryStorage;

  function start(): { service: WorldbuildService; worlds: WorldsService } {
    TestBed.configureTestingModule({ providers: [{ provide: StorageService, useValue: storage }] });
    return { service: TestBed.inject(WorldbuildService), worlds: TestBed.inject(WorldsService) };
  }

  beforeEach(() => {
    localStorage.clear();
    storage = new MemoryStorage();
  });

  it('importa a Lore geral para o primeiro mundo, uma vez, e mantém a cópia antiga', async () => {
    storage.data.set('worldbuild:guest', [item('meu')]);
    storage.data.set(LEGACY_LORE_KEY, [item('npc-lore', 'npc'), item('raca', 'race')]);
    const { service } = start();
    await settle();

    const ids = service.items().map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['meu', 'npc-lore', 'raca']));
    const folder = service.items().find((i) => i.name === LEGACY_LORE_FOLDER);
    expect(folder?.type).toBe('folder');
    expect(service.byId().get('npc-lore')?.parentId).toBe(folder?.id);
    // Gravado no mundo, marcado como importado e com a chave antiga intacta
    expect((storage.data.get('worldbuild:guest') as WorldItem[]).length).toBe(4);
    expect(storage.data.get(LEGACY_LORE_IMPORTED_KEY)).toBe('guest');
    expect(storage.data.has(LEGACY_LORE_KEY)).toBe(true);
  });

  it('não importa de novo se já foi importada', async () => {
    storage.data.set(LEGACY_LORE_KEY, [item('x')]);
    storage.data.set(LEGACY_LORE_IMPORTED_KEY, 'outro');
    const { service } = start();
    await settle();
    expect(service.items()).toEqual([]);
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
