import { TestBed } from '@angular/core/testing';
import { TableState } from '../../../core/models/table-session.model';
import { StorageService } from '../../../core/services/storage.service';
import { TableSessionService } from './table-session.service';

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

/**
 * Fachada da mesa: os métodos públicos continuam funcionando como antes, agora passando
 * pelos comandos puros de state/. Testa a ligação serviço → comando → gravação.
 */
describe('TableSessionService (fachada)', () => {
  let storage: MemoryStorage;
  let session: TableSessionService;

  beforeEach(async () => {
    storage = new MemoryStorage();
    TestBed.configureTestingModule({ providers: [TableSessionService, { provide: StorageService, useValue: storage }] });
    session = TestBed.inject(TableSessionService);
    await session.load('mesa');
  });

  it('cria cena, coloca, move e remove um token', async () => {
    const scene = await session.addScene();
    expect(session.activeScene()?.id).toBe(scene.id);
    const pc = session.addEntry('character');
    const placement = session.placeToken(pc.id, { x: 10, y: 20 });
    expect(session.selectedTokenId()).toBe(placement?.id);

    session.moveToken(placement!.id, { x: 70, y: 70 });
    expect(session.resolvedTokenById(placement!.id)?.placement).toMatchObject({ x: 70, y: 70 });

    session.removeToken(placement!.id);
    expect(session.tokens()).toEqual([]);
    expect(session.selectedTokenId()).toBeNull();
  });

  it('regra de vínculo: alterar o token do personagem altera a ficha', async () => {
    await session.addScene();
    const pc = session.addEntry('character');
    const placement = session.placeToken(pc.id, { x: 0, y: 0 })!;
    session.updateToken(placement.id, { size: 3 });
    expect(session.entryById().get(pc.id)?.token?.size).toBe(3);
    expect(session.tokens()[0].size).toBeUndefined();
  });

  it('visão de NPC é de cada token: ligar num token não muda os outros nem o NPC', async () => {
    await session.addScene();
    const npc = session.addEntry('npc');
    const a = session.placeToken(npc.id, { x: 0, y: 0 })!;
    const b = session.placeToken(npc.id, { x: 70, y: 0 })!;
    session.updateToken(a.id, { vision: { enabled: true, range: 30 } });
    expect(session.resolvedTokenById(a.id)?.vision).toEqual({ enabled: true, range: 30 });
    expect(session.resolvedTokenById(b.id)?.vision.enabled).toBe(false);
    expect(session.tokenOf(session.entryById().get(npc.id)!).vision.enabled).toBe(false);

    // "Usar como padrão do NPC" leva a visão; os próximos tokens copiam
    session.saveTokenAsDefault(a.id);
    const c = session.placeToken(npc.id, { x: 140, y: 0 })!;
    expect(session.resolvedTokenById(c.id)?.vision).toEqual({ enabled: true, range: 30 });
    expect(session.resolvedTokenById(b.id)?.vision.enabled).toBe(false);
  });

  it('copiar e colar: cópia exata do token, inclusive em outra cena', async () => {
    const first = await session.addScene();
    const npc = session.addEntry('npc');
    const orig = session.placeToken(npc.id, { x: 0, y: 0 })!;
    session.updateToken(orig.id, { size: 2, vision: { enabled: true, range: 9 } });
    session.renameSheet(`npc:${orig.id}`, 'Chefe');
    expect(session.copyTokens([orig.id])).toBe(1);

    await session.addScene();
    const [pasted] = session.pasteTokens({ x: 140, y: 70 });
    expect(session.activeScene()?.tokens?.map((t) => t.id)).toEqual([pasted.id]);
    expect(session.selectedTokenId()).toBe(pasted.id);
    const token = session.resolvedTokenById(pasted.id)!;
    expect(token).toMatchObject({ name: 'Chefe', size: 2, vision: { enabled: true, range: 9 } });
    expect(token.placement).toMatchObject({ x: 140, y: 70 });

    // A cópia é independente do original
    session.updateToken(pasted.id, { size: 1 });
    session.setActiveScene(first.id);
    expect(session.resolvedTokenById(orig.id)?.size).toBe(2);
  });

  it('copiar e colar respeita as permissões e a ficha excluída', async () => {
    await session.addScene();
    const npc = session.addEntry('npc');
    const t = session.placeToken(npc.id, { x: 0, y: 0 })!;
    session.setRole('player');
    expect(session.copyTokens([t.id])).toBe(0);
    session.setRole('gm');
    expect(session.copyTokens([t.id])).toBe(1);
    session.removeEntry(npc.id);
    expect(session.pasteTokens({ x: 0, y: 0 })).toEqual([]);
  });

  it('seleção: Shift+clique, caixa e remoção mantêm o grupo e o principal coerentes', async () => {
    await session.addScene();
    const npc = session.addEntry('npc');
    const [a, b, c] = [0, 70, 140].map((x) => session.placeToken(npc.id, { x, y: 0 })!);
    // placeToken seleciona só o último colocado
    expect([...session.selectedTokenIds()]).toEqual([c.id]);
    session.toggleTokenSelection(a.id);
    expect(session.selectedTokenId()).toBe(a.id);
    expect(session.movableSelection().map((t) => t.placement.id)).toEqual([a.id, c.id]);

    session.selectTokens([b.id], true);
    expect(session.selectedTokenIds().size).toBe(3);
    session.removeToken(a.id);
    expect(session.selectedTokenIds().has(a.id)).toBe(false);
    expect(session.selectedTokenId()).not.toBeNull();

    // O jogador não move NPC que não controla: fica fora do grupo móvel
    session.setRole('player');
    expect(session.movableSelection()).toEqual([]);
  });

  it('grupo: moveTokens move todos; copiar e colar mantém a formação', async () => {
    await session.addScene();
    const pc = session.addEntry('character');
    const a = session.placeToken(pc.id, { x: 0, y: 0 })!;
    const b = session.placeToken(pc.id, { x: 70, y: 140 })!;
    session.moveTokens([
      { placementId: a.id, x: 70, y: 70 },
      { placementId: b.id, x: 140, y: 210 },
    ]);
    expect(session.resolvedTokenById(b.id)?.placement).toMatchObject({ x: 140, y: 210 });

    expect(session.copyTokens([a.id, b.id])).toBe(2);
    const pasted = session.pasteTokens({ x: 700, y: 700 });
    expect(pasted.map((t) => [t.x, t.y])).toEqual([
      [700, 700],
      [770, 840],
    ]);
    expect(session.selectedTokenId()).toBe(pasted[0].id);
    expect(session.selectedTokenIds().size).toBe(2);
  });

  it('flush grava o estado na chave da mesa', async () => {
    await session.addScene();
    session.sendChat('olá');
    session.flush();
    const saved = storage.data.get('table-state:mesa') as TableState;
    expect(saved.scenes.length).toBe(1);
    expect(saved.chat?.[0].text).toBe('olá');
  });

  it('desenho: Ctrl+Z desfaz o traço e depois a borracha', async () => {
    await session.addScene();
    session.addStroke({ points: [], color: '#fff', width: 4, opacity: 1 });
    session.addStroke({ points: [], color: '#000', width: 4, opacity: 1 });
    session.eraseStrokes([session.drawings()[0].id]);
    expect(session.drawings().map((d) => d.color)).toEqual(['#000']);
    expect(session.undoDrawing()).toBe(true);
    expect(session.drawings().map((d) => d.color)).toEqual(['#fff', '#000']);
    expect(session.undoDrawing()).toBe(true);
    expect(session.drawings().map((d) => d.color)).toEqual(['#fff']);
  });

  it('estudos: falha crítica no 2d12 tira 1 SA; 3d6 não treina', () => {
    const pc = session.addEntry('character');
    const studies = [
      { id: 's1', text: 'Esgrima', sa: 2, sn: 4 },
      { id: 's2', text: '', sa: 0, sn: 0 },
      { id: 's3', text: '', sa: 0, sn: 0 },
    ];
    session.updateSheet(pc.id, { studies });
    const saOf = () => session.sheetData(pc.id)?.sheet.studies.find((s) => s.id === 's1')?.sa;

    // −30 garante total < 0 no 2d12 (falha crítica)
    const { roll } = session.quickRoll('2d12', -30, pc.id, 0, ['s1']);
    expect(roll.outcome).toBe('critical-failure');
    expect(saOf()).toBe(1);

    session.quickRoll('3d6', 30, pc.id, 0, ['s1']);
    expect(saOf()).toBe(1);
  });

  it('permissões seguem o papel: o jogador não edita NPC que não controla', () => {
    const npc = session.addEntry('npc');
    expect(session.canEdit(npc)).toBe(true);
    session.setRole('player');
    expect(session.canEdit(npc)).toBe(false);
    expect(session.canOpenSheet(npc.id)).toBe(false);
  });
});
