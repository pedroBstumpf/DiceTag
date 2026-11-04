import { CharacterSheet, InventoryEntry, TableState, defaultSheet } from '../../../core/models/table-session.model';
import { dropFromInventory, inventoryHolder, pickUpDrop, transferItem, unitNeedsImageCopy } from './inventory';

const sheet = (inventory: InventoryEntry[], eiros = 0): CharacterSheet => ({ ...defaultSheet(), inventory, eiros });

function table(from: InventoryEntry[], eiros = 10): TableState {
  return {
    activeSceneId: 's',
    entries: [
      { id: 'ana', kind: 'character', name: 'Ana', createdAt: 0, sheet: sheet(from, eiros) },
      { id: 'bia', kind: 'character', name: 'Bia', createdAt: 0, sheet: sheet([], eiros) },
      { id: 'orc', kind: 'npc', name: 'Orc', createdAt: 0 },
      { id: 'ref', kind: 'npc', name: 'Do bestiário', createdAt: 0, worldNpcId: 'mundo' },
    ],
    scenes: [
      {
        id: 's',
        name: 'Cena',
        gridSize: 70,
        showGrid: true,
        tokens: [{ id: 't', entryId: 'orc', x: 0, y: 0, sheet: sheet([{ id: 'loja', itemId: 'adaga', price: 4, quantity: 2 }]) }],
        drops: [{ id: 'chao', x: 5, y: 5, item: { id: 'x', itemId: 'adaga', quantity: 3 } }],
      },
    ],
  };
}

const inventoryOf = (state: TableState, id: string) => inventoryHolder(state, id)!.sheet.inventory;

describe('inventoryHolder', () => {
  it('acha a ficha do personagem e a cópia do token', () => {
    expect(inventoryHolder(table([]), 'ana')?.keepEmpty).toBe(false);
    expect(inventoryHolder(table([]), 'npc:t')?.keepEmpty).toBe(true);
  });

  it('NPC-referência e ficha inexistente não têm inventário na mesa', () => {
    expect(inventoryHolder(table([]), 'ref')).toBeNull();
    expect(inventoryHolder(table([]), 'ninguem')).toBeNull();
    expect(inventoryHolder(table([]), 'npc:ninguem')).toBeNull();
  });
});

describe('transferItem', () => {
  const give = { fromId: 'ana', inventoryId: 'i', toId: 'bia', newEntryId: 'novo' };

  it('passa uma unidade, e a linha some ao zerar no personagem', () => {
    const next = transferItem(table([{ id: 'i', itemId: 'adaga' }]), give);
    expect(inventoryOf(next, 'ana')).toEqual([]);
    expect(inventoryOf(next, 'bia')).toEqual([{ id: 'novo', itemId: 'adaga' }]);
  });

  it('a loja baixa 1 e mantém a linha; o preço não vai junto e os Eiros saem de quem recebe', () => {
    const next = transferItem(table([]), { fromId: 'npc:t', inventoryId: 'loja', toId: 'ana', newEntryId: 'novo', cost: 4 });
    expect(inventoryOf(next, 'npc:t')[0].quantity).toBe(1);
    expect(inventoryOf(next, 'ana')).toEqual([{ id: 'novo', itemId: 'adaga' }]);
    expect(inventoryHolder(next, 'ana')!.sheet.eiros).toBe(6);
  });

  it('sem Eiros, sem unidade, sem ficha ou para si mesmo: o estado não muda', () => {
    const noMoney = table([], 3);
    expect(transferItem(noMoney, { fromId: 'npc:t', inventoryId: 'loja', toId: 'ana', newEntryId: 'n', cost: 4 })).toBe(noMoney);
    const soldOut = table([{ id: 'i', itemId: 'adaga', quantity: 0 }]);
    expect(transferItem(soldOut, give)).toBe(soldOut);
    const state = table([{ id: 'i', itemId: 'adaga' }]);
    expect(transferItem(state, { ...give, toId: 'ref' })).toBe(state);
    expect(transferItem(state, { ...give, toId: 'ana' })).toBe(state);
  });

  it('duas compras da última unidade: a segunda não duplica o item', () => {
    const buy = { fromId: 'npc:t', inventoryId: 'loja', toId: 'ana', newEntryId: 'a', cost: 1 };
    const twice = [buy, buy, buy].reduce(transferItem, table([]));
    expect(inventoryOf(twice, 'npc:t')[0].quantity).toBe(0);
    expect(inventoryOf(twice, 'ana')[0].quantity).toBe(2);
    expect(inventoryHolder(twice, 'ana')!.sheet.eiros).toBe(8);
  });

  it('a imagem vai junto quando a linha some; se a linha fica, a unidade leva a cópia', () => {
    const last = transferItem(table([{ id: 'i', itemId: 'adaga', blobId: 'img' }]), give);
    expect(inventoryOf(last, 'bia')[0].blobId).toBe('img');
    const copy = transferItem(table([{ id: 'i', itemId: 'adaga', blobId: 'img', quantity: 2 }]), { ...give, blobId: 'copia' });
    expect(inventoryOf(copy, 'ana')[0].blobId).toBe('img');
    expect(inventoryOf(copy, 'bia')[0].blobId).toBe('copia');
    const without = transferItem(table([{ id: 'i', itemId: 'adaga', blobId: 'img', quantity: 2 }]), give);
    expect(inventoryOf(without, 'bia')[0].blobId).toBeUndefined();
  });
});

describe('unitNeedsImageCopy', () => {
  it('só quando a linha continua na origem e tem imagem própria', () => {
    const state = table([]);
    const character = inventoryHolder(state, 'ana')!;
    const npc = inventoryHolder(state, 'npc:t')!;
    expect(unitNeedsImageCopy(character, { id: 'i', itemId: 'a', blobId: 'b' })).toBe(false);
    expect(unitNeedsImageCopy(character, { id: 'i', itemId: 'a', blobId: 'b', quantity: 2 })).toBe(true);
    expect(unitNeedsImageCopy(npc, { id: 'i', itemId: 'a', blobId: 'b' })).toBe(true);
    expect(unitNeedsImageCopy(npc, { id: 'i', itemId: 'a' })).toBe(false);
  });
});

describe('dropFromInventory', () => {
  const drop = { sceneId: 's', sheetId: 'ana', inventoryId: 'i', dropId: 'd', itemEntryId: 'u', x: 1, y: 2 };

  it('a unidade sai da ficha e aparece no chão, sem preço nem "equipado"', () => {
    const next = dropFromInventory(table([{ id: 'i', itemId: 'adaga', equipped: true, price: 9 }]), { ...drop, level: 2 });
    expect(inventoryOf(next, 'ana')).toEqual([]);
    expect(next.scenes[0].drops?.at(-1)).toEqual({ id: 'd', x: 1, y: 2, level: 2, item: { id: 'u', itemId: 'adaga' } });
  });

  it('cena inexistente ou sem o item: nada muda (o item nunca some no meio do caminho)', () => {
    const state = table([{ id: 'i', itemId: 'adaga' }]);
    expect(dropFromInventory(state, { ...drop, sceneId: 'outra' })).toBe(state);
    expect(dropFromInventory(state, { ...drop, inventoryId: 'nada' })).toBe(state);
  });
});

describe('pickUpDrop', () => {
  it('a pilha inteira vai para a ficha e sai do chão', () => {
    const next = pickUpDrop(table([]), { dropId: 'chao', sheetId: 'ana', newEntryId: 'n' });
    expect(inventoryOf(next, 'ana')).toEqual([{ id: 'n', itemId: 'adaga', quantity: 3 }]);
    expect(next.scenes[0].drops).toEqual([]);
  });

  it('dois jogadores pegando o mesmo item: só o primeiro leva', () => {
    const first = pickUpDrop(table([]), { dropId: 'chao', sheetId: 'ana', newEntryId: 'n' });
    expect(pickUpDrop(first, { dropId: 'chao', sheetId: 'bia', newEntryId: 'm' })).toBe(first);
  });

  it('ficha que não está na mesa: o item fica no chão', () => {
    const state = table([]);
    expect(pickUpDrop(state, { dropId: 'chao', sheetId: 'ref', newEntryId: 'n' })).toBe(state);
  });
});
