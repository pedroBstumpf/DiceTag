import { TableEntry } from '../../../core/models/table-session.model';
import { WorldItem } from '../../../core/models/world-item.model';
import { npcAbilitiesOf, toStoredAbility, withAbility, withoutAbility } from './npc-abilities';

const ability = (id: string, name = id): TableEntry => ({ id, kind: 'automation', name, createdAt: 0 });
const goblin: WorldItem = { id: 'goblin', type: 'npc', name: 'Goblin', parentId: null, createdAt: 0, updatedAt: 0, abilities: [ability('faca')] };
const ref = (id: string, worldNpcId?: string): TableEntry => ({ id, kind: 'npc', name: id, createdAt: 0, worldNpcId });
const npcOf = (e: TableEntry) => (e.worldNpcId === 'goblin' ? goblin : undefined);

describe('habilidades dos NPCs do bestiário', () => {
  it('viram ações do NPC-referência; NPC antigo (sem referência) não tem', () => {
    const list = npcAbilitiesOf([ref('g1', 'goblin'), ref('velho')], npcOf);
    expect(list).toEqual([{ entry: { ...ability('faca'), ownerEntryId: 'g1' }, npcId: 'goblin' }]);
  });

  it('o mesmo NPC duas vezes na mesa: as habilidades ficam com a primeira referência', () => {
    const list = npcAbilitiesOf([ref('g1', 'goblin'), ref('g2', 'goblin')], npcOf);
    expect(list.map((a) => a.entry.ownerEntryId)).toEqual(['g1']);
  });

  it('guardar tira o dono; incluir substitui pelo id; remover', () => {
    const stored = toStoredAbility({ ...ability('x'), ownerEntryId: 'g1' });
    expect(stored).toEqual(ability('x'));
    expect(withAbility([ability('a')], stored).map((a) => a.id)).toEqual(['a', 'x']);
    expect(withAbility([ability('x', 'velha')], stored)[0].name).toBe('x');
    expect(withAbility(undefined, stored)).toEqual([stored]);
    expect(withoutAbility([ability('a'), stored], 'a')).toEqual([stored]);
  });
});
