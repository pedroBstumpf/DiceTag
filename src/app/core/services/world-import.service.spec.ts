import { CharacterSheet, defaultSheet, defaultToken } from '../models/table-session.model';
import { WorldItem } from '../models/world-item.model';
import { withNewBlobIds } from './world-import.service';

const base: WorldItem = { id: 'i', type: 'npc', name: 'Orc', parentId: null, createdAt: 0, updatedAt: 0 };

describe('withNewBlobIds', () => {
  const ids = new Map([
    ['velha', 'nova'],
    ['inv', 'inv2'],
  ]);

  it('troca os ids da imagem, do token, das raças e do inventário', () => {
    const sheet: CharacterSheet = { ...defaultSheet(), inventory: [{ id: 'l', itemId: 'x', blobId: 'inv' }] };
    const item = withNewBlobIds({ ...base, blobId: 'velha', maleBlobId: 'velha', token: { ...defaultToken('npc'), blobId: 'velha' }, sheet }, ids);
    expect(item.blobId).toBe('nova');
    expect(item.maleBlobId).toBe('nova');
    expect(item.token?.blobId).toBe('nova');
    expect(item.sheet?.inventory[0].blobId).toBe('inv2');
  });

  it('imagem que não foi enviada fica sem referência (nada aponta para um arquivo que não existe lá)', () => {
    const sheet: CharacterSheet = { ...defaultSheet(), inventory: [{ id: 'l', itemId: 'x', blobId: 'perdida' }] };
    const item = withNewBlobIds({ ...base, blobId: 'perdida', token: { ...defaultToken('npc'), blobId: 'perdida' }, sheet }, ids);
    expect(item.blobId).toBeUndefined();
    expect(item.token?.blobId).toBeUndefined();
    expect(item.sheet?.inventory[0].blobId).toBeUndefined();
    expect(item.sheet?.inventory[0].itemId).toBe('x');
  });

  it('não altera o item original (o mundo local continua intacto)', () => {
    const original = { ...base, blobId: 'velha' };
    withNewBlobIds(original, ids);
    expect(original.blobId).toBe('velha');
  });
});
