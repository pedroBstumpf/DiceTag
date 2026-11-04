import { InventoryEntry } from '../../../core/models/table-session.model';
import { keepValidItemTags } from './dice';
import { addOne, itemTagId, itemTagLevel, quantityOf, takeOne, unitOf, equippedTagLevels } from './inventory';

let n = 0;
const id = () => `novo-${++n}`;

describe('inventário: quantidades', () => {
  it('itens sem quantidade valem 1', () => {
    expect(quantityOf({ id: 'a', itemId: 'x' })).toBe(1);
  });

  it('takeOne na loja mantém a linha com 0', () => {
    const { list, removed } = takeOne([{ id: 'a', itemId: 'x', quantity: 1, price: 5 }], 'a', true);
    expect(removed).toBe(false);
    expect(list[0].quantity).toBe(0);
    // Esgotado: nada a tirar
    expect(takeOne(list, 'a', true).list).toBe(list);
  });

  it('takeOne no personagem remove a linha ao zerar', () => {
    const { list, removed } = takeOne([{ id: 'a', itemId: 'x' }], 'a', false);
    expect(removed).toBe(true);
    expect(list).toEqual([]);
    expect(takeOne([{ id: 'a', itemId: 'x', quantity: 3 }], 'a', false).list[0].quantity).toBe(2);
  });

  it('addOne empilha itens idênticos e não leva o preço', () => {
    const base: InventoryEntry[] = [{ id: 'a', itemId: 'x', name: 'Poção', quantity: 2 }];
    const stacked = addOne(base, { id: 'loja', itemId: 'x', name: 'Poção', price: 9, quantity: 4 }, id);
    expect(stacked).toEqual([{ id: 'a', itemId: 'x', name: 'Poção', quantity: 3 }]);
  });

  it('addOne não empilha item da mesa com item do Worldbuild de mesmo id', () => {
    const base: InventoryEntry[] = [{ id: 'a', itemId: 'x' }];
    const added = addOne(base, { id: 'b', itemId: 'x', table: true }, id);
    expect(added).toHaveLength(2);
    expect(added[1].table).toBe(true);
  });

  it('addOne não leva o "equipado" de quem deu', () => {
    const given = addOne([], { id: 'a', itemId: 'x', equipped: true }, id);
    expect(given[0].equipped).toBeUndefined();
  });

  it('addOne com várias unidades (pegar uma pilha do chão) empilha ou cria a linha com a quantidade', () => {
    const base: InventoryEntry[] = [{ id: 'a', itemId: 'x', quantity: 2 }];
    expect(addOne(base, { id: 'chao', itemId: 'x', quantity: 5 }, id, 5)[0].quantity).toBe(7);
    const fresh = addOne([], { id: 'chao', itemId: 'y' }, id, 3);
    expect(fresh[0]).toMatchObject({ itemId: 'y', quantity: 3 });
    expect(addOne([], { id: 'chao', itemId: 'y' }, id, 1)[0].quantity).toBeUndefined();
  });

  it('unitOf tira o que é só da linha de origem', () => {
    expect(unitOf({ id: 'a', itemId: 'x', name: 'Poção', price: 3, quantity: 2, equipped: true })).toEqual({ itemId: 'x', name: 'Poção' });
  });

  it('addOne cria linha nova se a personalização ou a imagem diferem', () => {
    const base: InventoryEntry[] = [{ id: 'a', itemId: 'x' }];
    expect(addOne(base, { id: 'b', itemId: 'x', name: 'Outra' }, id)).toHaveLength(2);
    const withImage = addOne(base, { id: 'c', itemId: 'x', blobId: 'img' }, id);
    expect(withImage).toHaveLength(2);
    expect(withImage[1]).toMatchObject({ itemId: 'x', blobId: 'img' });
    expect(withImage[1].price).toBeUndefined();
  });
});

describe('etiquetas de itens equipados nas rolagens', () => {
  it('id por linha do inventário e valor = nível (sem nível vale 1)', () => {
    expect(itemTagId('linha', 'tag')).toBe('item:linha:tag');
    expect(itemTagLevel({ id: 't', text: 'Afiada', color: '#fff', level: 2 })).toBe(2);
    expect(itemTagLevel({ id: 't', text: 'Mágica', color: '#fff' })).toBe(1);
  });

  it('keepValidItemTags tira só as etiquetas de itens que saíram e mantém as dos temas', () => {
    const attrs = ['tema-1', itemTagId('espada', 'a'), itemTagId('escudo', 'b')];
    expect(keepValidItemTags(attrs, new Set([itemTagId('espada', 'a')]))).toEqual(['tema-1', itemTagId('espada', 'a')]);
    expect(keepValidItemTags(attrs, new Set([itemTagId('espada', 'a'), itemTagId('escudo', 'b')]))).toBeNull();
  });

  it('keepValidItemTags reconhece etiquetas ligadas como penalidade', () => {
    const negated = '-' + itemTagId('escudo', 'b');
    expect(keepValidItemTags(['tema-1', negated], new Set())).toEqual(['tema-1']);
    expect(keepValidItemTags([negated], new Set([itemTagId('escudo', 'b')]))).toBeNull();
  });
});

describe('equippedTagLevels', () => {
  const sources = {
    own: new Map([['espada', { id: 'espada', name: 'Espada', tags: [{ id: 'a', text: 'Afiada', color: '#fff', level: 2 }, { id: 'b', text: 'Leve', color: '#fff' }] }]]),
    table: new Map(),
  };

  it('só itens equipados; sem nível vale 1; a personalização vale no lugar do original', () => {
    expect(equippedTagLevels([{ id: 'l', itemId: 'espada', equipped: true }], sources)).toEqual([
      ['item:l:a', 2],
      ['item:l:b', 1],
    ]);
    expect(equippedTagLevels([{ id: 'l', itemId: 'espada' }], sources)).toEqual([]);
    expect(equippedTagLevels([{ id: 'l', itemId: 'espada', equipped: true, tags: [{ id: 'c', text: 'Mágica', color: '#fff', level: 4 }] }], sources)).toEqual([['item:l:c', 4]]);
  });
});
