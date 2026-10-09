import { TableState } from '../../../core/models/table-session.model';
import {
  addLoreFolder,
  addTableItem,
  hideLoreItem,
  moveLoreItem,
  removeLoreFolder,
  renameLoreFolder,
  renameLoreItem,
  restoreLoreItems,
  toggleLoreFolderPublic,
  updateTableItem,
} from './lore';

const empty = (): TableState => ({ scenes: [], activeSceneId: null, entries: [] });

describe('comandos: lore da mesa', () => {
  it('pasta: criar, renomear (ignora vazio) e revelar/esconder', () => {
    let s = addLoreFolder(empty(), { folder: { id: 'f', name: 'Nova pasta' } });
    expect(renameLoreFolder(s, { folderId: 'f', name: ' ' })).toBe(s);
    s = renameLoreFolder(s, { folderId: 'f', name: 'Segredos' });
    s = toggleLoreFolderPublic(s, { folderId: 'f' });
    expect(s.lore?.folders[0]).toEqual({ id: 'f', name: 'Segredos', public: true });
    s = toggleLoreFolderPublic(s, { folderId: 'f' });
    expect(s.lore?.folders[0].public).toBeUndefined();
  });

  it('renomear item igual ao original (ou vazio) volta ao nome original', () => {
    let s = renameLoreItem(empty(), { itemId: 'i', originalName: 'Espada', name: ' Lâmina ' });
    expect(s.lore?.items['i'].name).toBe('Lâmina');
    s = renameLoreItem(s, { itemId: 'i', originalName: 'Espada', name: 'Espada' });
    expect(s.lore?.items['i'].name).toBeUndefined();
  });

  it('excluir a pasta devolve os itens dela à raiz', () => {
    let s = addLoreFolder(empty(), { folder: { id: 'f', name: 'P' } });
    s = moveLoreItem(s, { itemId: 'i', folderId: 'f' });
    s = removeLoreFolder(s, { folderId: 'f' });
    expect(s.lore?.folders).toEqual([]);
    expect(s.lore?.items['i'].folderId).toBeUndefined();
  });

  it('esconder e restaurar itens desta mesa', () => {
    let s = hideLoreItem(empty(), { itemId: 'i' });
    expect(s.lore?.items['i'].hidden).toBe(true);
    s = restoreLoreItems(s);
    expect(s.lore?.items['i'].hidden).toBeUndefined();
  });

  it('itens criados na mesa', () => {
    let s = addTableItem(empty(), { item: { id: 'x', name: 'Mapa', createdAt: 0 } });
    s = updateTableItem(s, { itemId: 'x', patch: { description: 'Antigo', blobId: 'b' } });
    expect(s.items?.[0]).toMatchObject({ name: 'Mapa', description: 'Antigo', blobId: 'b' });
  });
});
