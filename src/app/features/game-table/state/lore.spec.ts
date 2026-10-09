import { TableState } from '../../../core/models/table-session.model';
import { addTableItem, toggleLoreReveal, updateTableItem } from './lore';
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
