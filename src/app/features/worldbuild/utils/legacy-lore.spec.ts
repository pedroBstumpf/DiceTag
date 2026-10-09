import { WorldItem } from '../../../core/models/world-item.model';
import { LEGACY_LORE_FOLDER, mergeLegacyLore } from './legacy-lore';

const item = (id: string, parentId: string | null = null, type: WorldItem['type'] = 'document'): WorldItem => ({
  id,
  type,
  name: id,
  parentId,
  createdAt: 0,
  updatedAt: 0,
});

describe('importação da Lore geral antiga', () => {
  it('itens da raiz vão para a pasta nova; os demais mantêm a pasta; ids mantidos', () => {
    const merged = mergeLegacyLore([item('meu')], [item('a'), item('pasta', null, 'folder'), item('b', 'pasta')], { id: 'imp', now: 5 });
    const byId = new Map(merged.map((i) => [i.id, i]));
    expect(byId.get('imp')).toMatchObject({ type: 'folder', name: LEGACY_LORE_FOLDER, parentId: null });
    expect(byId.get('a')?.parentId).toBe('imp');
    expect(byId.get('pasta')?.parentId).toBe('imp');
    expect(byId.get('b')?.parentId).toBe('pasta');
    expect(byId.get('meu')?.parentId).toBeNull();
  });

  it('sem nada novo, devolve a mesma lista (nem cria a pasta)', () => {
    const items = [item('a')];
    expect(mergeLegacyLore(items, [], { id: 'imp', now: 0 })).toBe(items);
    expect(mergeLegacyLore(items, [item('a')], { id: 'imp', now: 0 })).toBe(items);
  });
});
