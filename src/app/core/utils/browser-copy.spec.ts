import { describe, expect, it } from 'vitest';
import { buildCopy, copyContents, isCopyKey, readCopy, stateBlobIds, stateForServer } from './browser-copy';

const png = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' });
const wav = new Blob([new Uint8Array([9, 8])], { type: 'audio/wav' });

const bytesOf = async (blob: Blob | undefined) => [...new Uint8Array(await blob!.arrayBuffer())];

describe('cópia do navegador: arquivo', () => {
  it('devolve os dados e cada arquivo como eram', async () => {
    const data = { tables: [{ id: 'm1', name: 'Mesa ação' }] };
    const copy = await readCopy(
      buildCopy(
        data,
        [
          { id: 'a', blob: png },
          { id: 'b', blob: wav },
        ],
        123,
      ),
    );
    expect(copy.createdAt).toBe(123);
    expect(copy.data).toEqual(data);
    expect(copy.fileIds).toEqual(['a', 'b']);
    expect(await bytesOf(copy.file('a'))).toEqual([1, 2, 3, 4]);
    expect(await bytesOf(copy.file('b'))).toEqual([9, 8]);
    expect(copy.file('b')?.type).toBe('audio/wav');
    expect(copy.file('c')).toBeUndefined();
  });

  it('recusa o que não é uma cópia', async () => {
    await expect(readCopy(new Blob(['um arquivo qualquer']))).rejects.toThrow('não é uma cópia');
    await expect(readCopy(new Blob(['ZE']))).rejects.toThrow('não é uma cópia');
  });

  it('recusa uma cópia cortada no meio', async () => {
    const whole = buildCopy({}, [{ id: 'a', blob: png }], 1);
    await expect(readCopy(whole.slice(0, whole.size - 1))).rejects.toThrow('incompleto');
    await expect(readCopy(whole.slice(0, 20))).rejects.toThrow('incompleto');
  });

  it('não leva as senhas locais nem as janelas abertas', () => {
    expect(isCopyKey('users')).toBe(false);
    expect(isCopyKey('desk:guest:default')).toBe(false);
    expect(isCopyKey('blob:x')).toBe(false);
    for (const key of ['tables', 'worlds:guest', 'worldbuild:guest', 'worldbuild:guest:w2', 'table-state:m1']) {
      expect(isCopyKey(key)).toBe(true);
    }
  });
});

describe('cópia do navegador: conteúdo', () => {
  const item = { id: 'i1', type: 'folder', name: 'Pasta', parentId: null, createdAt: 1, updatedAt: 1 };

  it('lista mundos com o nome salvo e o padrão do primeiro', () => {
    const { worlds } = copyContents({
      'worlds:guest': [{ id: 'w2', name: 'Segundo', createdAt: 1 }],
      'worldbuild:guest': [item],
      'worldbuild:guest:w2': [item],
    });
    expect(worlds.map((w) => [w.key, w.name])).toEqual([
      ['worldbuild:guest', 'Meu mundo'],
      ['worldbuild:guest:w2', 'Segundo'],
    ]);
  });

  it('ignora mundos vazios, a não ser que uma mesa se passe neles', () => {
    const empty = copyContents({ 'worldbuild:guest': [] });
    expect(empty.worlds).toEqual([]);
    const used = copyContents({ 'worldbuild:guest': [], tables: [{ id: 'm1', ownerId: 'guest', name: 'Mesa' }] });
    expect(used.worlds.map((w) => w.key)).toEqual(['worldbuild:guest']);
    expect(used.tables[0].worldKey).toBe('worldbuild:guest');
    expect(used.tables[0].state).toBeUndefined();
  });

  it('liga a mesa ao mundo dela, pelo dono', () => {
    const { tables } = copyContents({
      tables: [{ id: 'm1', ownerId: 'conta', worldId: 'w2', name: 'Mesa' }],
      'table-state:m1': { scenes: [] },
    });
    expect(tables[0].worldKey).toBe('worldbuild:conta:w2');
    expect(tables[0].state).toEqual({ scenes: [] });
  });
});

describe('cópia do navegador: mesa no servidor', () => {
  const state = {
    scenes: [{ id: 's1', blobId: 'mapa', levels: [{ id: 'n1', blobId: 'nivel' }], effects: [{ ownerUserId: 'guest' }] }],
    entries: [
      { id: 'p1', kind: 'character', ownerUserId: 'guest', token: { blobId: 'rosto' }, sheet: { inventory: [{ itemId: 'i', blobId: 'item' }] } },
      { id: 'n1', kind: 'npc', controllerUserId: 'guest', worldNpcId: 'npc-do-mundo' },
      { id: 'a1', kind: 'automation', ownerEntryId: 'p1' },
    ],
    items: [{ id: 't1', ownerUserId: 'guest', blobId: 'mapa' }],
    chat: [{ id: 'c1', userId: 'guest', author: 'Mestre' }],
  };

  it('acha as imagens em qualquer lugar, sem repetir', () => {
    expect(stateBlobIds(state).sort()).toEqual(['item', 'mapa', 'nivel', 'rosto']);
  });

  it('troca os ids e passa o que era da conta local ao dono', () => {
    const ids = new Map([
      ['mapa', 'M'],
      ['nivel', 'N'],
      ['rosto', 'R'],
      ['item', 'I'],
    ]);
    const out = stateForServer(state, ids, 'dono') as typeof state;
    expect(out.scenes[0].blobId).toBe('M');
    expect(out.scenes[0].levels[0].blobId).toBe('N');
    expect(out.scenes[0].effects[0].ownerUserId).toBe('dono');
    expect(out.entries[0].token?.blobId).toBe('R');
    expect(out.entries[0].sheet?.inventory[0].blobId).toBe('I');
    expect(out.items[0]).toEqual({ id: 't1', ownerUserId: 'dono', blobId: 'M' });
    expect(out.chat[0].userId).toBe('dono');
  });

  it('deixa o personagem livre para o amigo vincular e tira o controle de NPC', () => {
    const out = stateForServer(state, new Map(), 'dono') as typeof state;
    expect('ownerUserId' in out.entries[0]).toBe(false);
    expect('controllerUserId' in out.entries[1]).toBe(false);
    expect(out.entries[1].worldNpcId).toBe('npc-do-mundo');
    expect(out.entries[2].ownerEntryId).toBe('p1');
  });

  it('imagem que não foi enviada perde a referência', () => {
    const out = stateForServer(state, new Map(), 'dono') as typeof state;
    expect('blobId' in out.scenes[0]).toBe(false);
  });

  it('não altera o estado original', () => {
    const before = JSON.stringify(state);
    stateForServer(state, new Map([['mapa', 'M']]), 'dono');
    expect(JSON.stringify(state)).toBe(before);
  });
});
