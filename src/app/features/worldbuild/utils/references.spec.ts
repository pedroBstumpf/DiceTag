import { WorldItem } from '../../../core/models/world-item.model';
import { referenceCandidates, resolveReferences } from './references';

const item = (id: string, name: string, type: WorldItem['type'] = 'document'): WorldItem => ({
  id,
  type,
  name,
  parentId: null,
  createdAt: 0,
  updatedAt: 0,
});

const items = [item('p', 'Pasta', 'folder'), item('r', 'Raça dos Elfos', 'race'), item('m', 'Mapa de Valdris', 'image'), item('t', 'Era I', 'timeline')];

describe('referências da linha do tempo', () => {
  it('candidatos: sem pastas nem excluídos, em ordem alfabética, busca sem acento', () => {
    expect(referenceCandidates(items, '', new Set(['t'])).map((i) => i.id)).toEqual(['m', 'r']);
    expect(referenceCandidates(items, 'raca', new Set()).map((i) => i.id)).toEqual(['r']);
    expect(referenceCandidates(items, '', new Set(), 1)).toHaveLength(1);
  });

  it('resolve só os que existem, na ordem ligada', () => {
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(resolveReferences(['m', 'sumiu', 'r'], byId).map((i) => i.id)).toEqual(['m', 'r']);
    expect(resolveReferences(undefined, byId)).toEqual([]);
  });
});
