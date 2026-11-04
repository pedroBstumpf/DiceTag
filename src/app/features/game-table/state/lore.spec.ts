import { TableState } from '../../../core/models/table-session.model';
import { addTableItem, toggleLoreReveal, updateTableItem, worldItemRefs } from './lore';
import { normalizeState } from './table-state';

const empty = (): TableState => ({ scenes: [], activeSceneId: null, entries: [] });

describe('comandos: lore da mesa', () => {
  it('revelar e esconder uma pasta do mundo', () => {
    let s = toggleLoreReveal(empty(), { folderId: 'f' });
    s = toggleLoreReveal(s, { folderId: 'g' });
    expect(s.lore?.revealed).toEqual(['f', 'g']);
    s = toggleLoreReveal(s, { folderId: 'f' });
    expect(s.lore?.revealed).toEqual(['g']);
  });

  it('mesas antigas (pastas e nomes próprios da aba Lore) abrem sem nada revelado', () => {
    const old = { ...empty(), lore: { folders: [{ id: 'x', name: 'P', public: true }], items: {} } } as unknown as TableState;
    expect(normalizeState(old).lore).toEqual({ revealed: [] });
  });

  it('itens criados na mesa', () => {
    let s = addTableItem(empty(), { item: { id: 'x', name: 'Mapa', createdAt: 0 } });
    s = updateTableItem(s, { itemId: 'x', patch: { description: 'Antigo', blobId: 'b' } });
    expect(s.items?.[0]).toMatchObject({ name: 'Mapa', description: 'Antigo', blobId: 'b' });
  });
});

describe('worldItemRefs', () => {
  it('junta inventários de fichas e tokens e itens no chão, sem os itens da mesa', () => {
    const refs = worldItemRefs({
      activeSceneId: 's',
      entries: [{ id: 'a', kind: 'character', name: 'A', createdAt: 0, sheet: { inventory: [{ id: '1', itemId: 'espada' }, { id: '2', itemId: 'da-mesa', table: true }] } as never }],
      scenes: [
        {
          id: 's',
          name: 'S',
          gridSize: 70,
          showGrid: true,
          tokens: [{ id: 't', entryId: 'a', x: 0, y: 0, sheet: { inventory: [{ id: '3', itemId: 'adaga' }] } as never }],
          drops: [{ id: 'd', x: 0, y: 0, item: { id: '4', itemId: 'moeda' } }],
        },
      ],
    });
    expect(refs.sort()).toEqual(['adaga', 'espada', 'moeda']);
  });
});
