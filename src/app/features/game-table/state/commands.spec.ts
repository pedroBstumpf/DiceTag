import { TableState } from '../../../core/models/table-session.model';
import { TABLE_COMMANDS, TableCommand, applyCommand } from './commands';
import { normalizeState } from './table-state';

const empty = (): TableState => ({ scenes: [], activeSceneId: null, entries: [] });

describe('comandos da mesa', () => {
  it('applyCommand aplica o comando pelo nome', () => {
    const s = applyCommand(empty(), { type: 'addScene', payload: { scene: { id: 'a', name: 'A', gridSize: 70, showGrid: true } } });
    expect(s.activeSceneId).toBe('a');
  });

  it('a mesma sequência de comandos, serializada e reaplicada, chega ao mesmo estado', () => {
    const commands: TableCommand[] = [
      { type: 'addScene', payload: { scene: { id: 'a', name: 'A', gridSize: 70, showGrid: true, tokens: [] } } },
      { type: 'addEntry', payload: { entry: { id: 'pc', kind: 'character', name: 'Ana', createdAt: 1 } } },
      { type: 'placeToken', payload: { sceneId: 'a', placement: { id: 't', entryId: 'pc', x: 0, y: 0 } } },
      { type: 'moveToken', payload: { placementId: 't', x: 70, y: 140 } },
      { type: 'clearChat', payload: {} },
    ];
    const local = commands.reduce(applyCommand, empty());
    // Ida e volta por JSON: é o que aconteceria ao mandar pela rede
    const remote = (JSON.parse(JSON.stringify(commands)) as TableCommand[]).reduce(applyCommand, empty());
    expect(remote).toEqual(local);
  });

  it('comando desconhecido (de uma versão mais nova) não altera o estado', () => {
    const s = empty();
    expect(applyCommand(s, { type: 'naoExiste', payload: {} } as unknown as TableCommand)).toBe(s);
  });

  it('todos os comandos são funções de (estado, payload)', () => {
    for (const reducer of Object.values(TABLE_COMMANDS)) expect(typeof reducer).toBe('function');
  });
});

describe('normalizeState', () => {
  it('mesa sem dados vira mesa vazia', () => {
    expect(normalizeState(undefined)).toEqual(empty());
  });

  it('completa cenas, sons e fichas antigos com os padrões', () => {
    const s = normalizeState({
      scenes: [{ id: 'a', name: 'A', gridSize: 70, showGrid: true }],
      activeSceneId: 'a',
      entries: [
        { id: 'som', kind: 'sound', name: 's', createdAt: 0 },
        { id: 'pc', kind: 'character', name: 'p', createdAt: 0 },
      ],
    });
    expect(s.scenes[0]).toMatchObject({ tokens: [], walls: [], drawings: [], notes: [], fog: { enabled: false } });
    expect(s.entries[0]).toMatchObject({ loop: true });
    expect(s.entries[0].volume).toBeGreaterThan(0);
    // Personagem ganha as três barras de status
    expect(s.entries[1].token?.bars.length).toBe(3);
  });
});
