import { InventoryEntry } from '../../../core/models/table-session.model';
import { addOne, quantityOf, takeOne } from './inventory';

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

  it('addOne cria linha nova se a personalização ou a imagem diferem', () => {
    const base: InventoryEntry[] = [{ id: 'a', itemId: 'x' }];
    expect(addOne(base, { id: 'b', itemId: 'x', name: 'Outra' }, id)).toHaveLength(2);
    const withImage = addOne(base, { id: 'c', itemId: 'x', blobId: 'img' }, id);
    expect(withImage).toHaveLength(2);
    expect(withImage[1]).toMatchObject({ itemId: 'x', blobId: 'img' });
    expect(withImage[1].price).toBeUndefined();
  });
});
