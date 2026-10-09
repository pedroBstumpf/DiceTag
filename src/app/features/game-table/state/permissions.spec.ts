import { TableEntry, TableLore, withStatusBars } from '../../../core/models/table-session.model';
import {
  FULL_ACCESS,
  NO_ACCESS,
  Viewer,
  canEdit,
  canEditStatusMax,
  canEditTableItem,
  canSeeLoreItem,
  controlsNpc,
  ownsCharacter,
  sheetAccess,
} from './permissions';

const gm: Viewer = { role: 'gm', userId: 'mestre' };
const ana: Viewer = { role: 'player', userId: 'ana' };
const bia: Viewer = { role: 'player', userId: 'bia' };
const entry = (kind: TableEntry['kind'], extra: Partial<TableEntry> = {}): TableEntry => ({
  id: 'e',
  kind,
  name: 'e',
  createdAt: 0,
  ...extra,
});
const alive = withStatusBars([]);
const down = alive.map((b, i) => (i === 0 ? { ...b, value: 0 } : b));

describe('permissões: fichas', () => {
  it('mestre edita tudo; jogador edita personagens; NPC só quem controla', () => {
    const npc = entry('npc', { controllerUserId: 'ana' });
    expect(canEdit(npc, gm)).toBe(true);
    expect(canEdit(npc, ana)).toBe(true);
    expect(canEdit(npc, bia)).toBe(false);
    expect(controlsNpc(npc, bia)).toBe(false);
    expect(canEdit(entry('character', { ownerUserId: 'ana' }), bia)).toBe(true);
  });

  it('personagem sem dono é de qualquer conta', () => {
    expect(ownsCharacter(entry('character'), bia)).toBe(true);
    expect(ownsCharacter(entry('character', { ownerUserId: 'ana' }), bia)).toBe(false);
  });

  it('ficha base de NPC: só quem edita', () => {
    expect(sheetAccess(gm, { entry: entry('npc'), bars: alive })).toEqual(FULL_ACCESS);
    expect(sheetAccess(ana, { entry: entry('npc'), bars: alive })).toEqual(NO_ACCESS);
    expect(sheetAccess(ana, null)).toEqual(NO_ACCESS);
  });

  it('token de NPC: o jogador vê o que o mestre liberou, e o inventário de um token derrotado', () => {
    const npc = entry('npc');
    const token = { id: 't', entryId: 'e', x: 0, y: 0 };
    expect(sheetAccess(ana, { entry: npc, bars: alive }, { ...token, sheetPublic: true })).toEqual({
      edit: false,
      sheet: true,
      inventory: false,
    });
    expect(sheetAccess(ana, { entry: npc, bars: down }, token)).toEqual({ edit: false, sheet: false, inventory: true });
  });

  it('máximo das barras de status: só o mestre edita à mão', () => {
    expect(canEditStatusMax(gm)).toBe(true);
    expect(canEditStatusMax(ana)).toBe(false);
  });

  it('fora da mesa (sem entrada) a ficha é editável', () => {
    expect(sheetAccess(ana, { bars: alive })).toEqual(FULL_ACCESS);
  });
});

describe('permissões: lore e itens da mesa', () => {
  const lore: TableLore = {
    folders: [
      { id: 'aberta', name: 'A', public: true },
      { id: 'fechada', name: 'F' },
    ],
    items: { a: { folderId: 'aberta' }, f: { folderId: 'fechada' }, h: { folderId: 'aberta', hidden: true } },
  };

  it('jogador vê só itens em pastas reveladas e não escondidos; mestre vê tudo', () => {
    expect(canSeeLoreItem(lore, 'a', false, ana)).toBe(true);
    expect(canSeeLoreItem(lore, 'f', false, ana)).toBe(false);
    expect(canSeeLoreItem(lore, 'h', false, ana)).toBe(false);
    expect(canSeeLoreItem(lore, 'solto', false, ana)).toBe(false);
    expect(canSeeLoreItem(lore, 'f', false, gm)).toBe(true);
  });

  it('itens criados na mesa ficam à vista na raiz', () => {
    expect(canSeeLoreItem(lore, 'solto', true, ana)).toBe(true);
    expect(canSeeLoreItem(lore, 'f', true, ana)).toBe(false);
  });

  it('item da mesa: quem criou e o mestre editam', () => {
    const item = { id: 'x', name: 'x', createdAt: 0, ownerUserId: 'ana' };
    expect(canEditTableItem(item, ana)).toBe(true);
    expect(canEditTableItem(item, bia)).toBe(false);
    expect(canEditTableItem(item, gm)).toBe(true);
    expect(canEditTableItem(undefined, gm)).toBe(false);
  });
});
