import { InventoryEntry } from '../../../core/models/table-session.model';
import { addOne, itemTagId, itemTagLevel, keepValidItemTags, quantityOf, takeOne } from './inventory';

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
});
