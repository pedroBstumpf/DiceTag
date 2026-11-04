import { TableState } from '../../../core/models/table-session.model';
import { TableCommand } from './commands';
import { ackCommand, burstKey, localCommand, mergeBurst, rejectCommand, remoteCommand, replaceState, squashPending, startSync } from './sync';

/** Cena com um token em (0, 0). */
const base = (): TableState => ({
  activeSceneId: 'a',
  entries: [{ id: 'pc', kind: 'character', name: 'Ana', createdAt: 1 }],
  scenes: [{ id: 'a', name: 'A', gridSize: 70, showGrid: true, tokens: [{ id: 't', entryId: 'pc', x: 0, y: 0 }] }],
});

const move = (x: number): TableCommand => ({ type: 'moveToken', payload: { placementId: 't', x, y: 0 } });
const rename = (name: string): TableCommand => ({ type: 'updateScene', payload: { sceneId: 'a', patch: { name } } });
const explored = (data: string): TableCommand => ({ type: 'setExplored', payload: { sceneId: 'a', explored: { cell: 10, cols: 1, rows: 1, data } } });
const tokenX = (s: TableState) => s.scenes[0].tokens?.[0].x;

describe('reconciliação da mesa online', () => {
  it('comando local aparece na tela na hora e fica pendente', () => {
    const sync = localCommand(startSync(base(), 1), 1, move(70));
    expect(tokenX(sync.view)).toBe(70);
    expect(tokenX(sync.confirmed)).toBe(0);
    expect(sync.pending.map((p) => p.seq)).toEqual([1]);
  });

  it('comando sem efeito não fica pendente (nem precisa ser enviado)', () => {
    const start = startSync(base(), 1);
    // Token que não existe mais (ex.: removido por outra pessoa): o comando devolve o mesmo estado
    const gone: TableCommand = { type: 'moveToken', payload: { placementId: 'removido', x: 70, y: 0 } };
    expect(localCommand(start, 1, gone)).toBe(start);
  });

  it('ack confirma com o payload final do servidor', () => {
    let sync = localCommand(startSync(base(), 1), 1, move(70));
    // O servidor pode ajustar o payload (aqui, outra posição): vale o dele
    sync = ackCommand(sync, 1, move(140), 2);
    expect(sync.pending).toEqual([]);
    expect(tokenX(sync.confirmed)).toBe(140);
    expect(tokenX(sync.view)).toBe(140);
    expect(sync.version).toBe(2);
  });

  it('nack desfaz só o comando recusado', () => {
    let sync = localCommand(startSync(base(), 1), 1, move(70));
    sync = localCommand(sync, 2, rename('Taverna'));
    sync = rejectCommand(sync, 1);
    expect(tokenX(sync.view)).toBe(0);
    expect(sync.view.scenes[0].name).toBe('Taverna');
    expect(sync.pending.map((p) => p.seq)).toEqual([2]);
  });

  it('comando de outra pessoa entra no confirmado e os pendentes são reaplicados por cima', () => {
    let sync = localCommand(startSync(base(), 1), 1, move(70));
    sync = remoteCommand(sync, rename('Masmorra'), 2);
    expect(sync.view.scenes[0].name).toBe('Masmorra');
    expect(tokenX(sync.view)).toBe(70);
    expect(tokenX(sync.confirmed)).toBe(0);
  });

  it('o último a chegar ao servidor vence: o ack posterior sobrepõe o comando remoto', () => {
    let sync = localCommand(startSync(base(), 1), 1, move(70));
    sync = remoteCommand(sync, move(210), 2);
    expect(tokenX(sync.view)).toBe(70);
    sync = ackCommand(sync, 1, move(70), 3);
    expect(tokenX(sync.view)).toBe(70);
  });

  it('estado completo substitui o confirmado e mantém os pendentes', () => {
    let sync = localCommand(startSync(base(), 1), 1, rename('Taverna'));
    const fromServer = { ...base(), scenes: [{ ...base().scenes[0], tokens: [] }] };
    sync = replaceState(sync, fromServer, 5);
    expect(sync.view.scenes[0].tokens).toEqual([]);
    expect(sync.view.scenes[0].name).toBe('Taverna');
    expect(sync.version).toBe(5);
  });

  it('ack ou nack de um seq desconhecido não muda nada', () => {
    const sync = localCommand(startSync(base(), 1), 1, move(70));
    expect(ackCommand(sync, 9, move(1), 2)).toBe(sync);
    expect(rejectCommand(sync, 9)).toBe(sync);
  });
});

describe('rajadas de comandos (arrastar, WASD, memória da névoa)', () => {
  it('movimentos e memória da névoa são agrupáveis; o resto vai na hora', () => {
    expect(burstKey(move(1))).toBe('move');
    expect(burstKey({ type: 'moveTokens', payload: { moves: [] } })).toBe('move');
    expect(burstKey(explored('1'))).toBe('explored:a');
    expect(burstKey(rename('B'))).toBeNull();
  });

  it('a rajada de movimentos vira um moveTokens com a última posição de cada token', () => {
    const merged = mergeBurst([
      move(10),
      { type: 'moveTokens', payload: { moves: [{ placementId: 'u', x: 5, y: 5 }, { placementId: 't', x: 20, y: 0 }] } },
      move(30),
    ]);
    expect(merged).toEqual({
      type: 'moveTokens',
      payload: { moves: [{ placementId: 'u', x: 5, y: 5 }, { placementId: 't', x: 30, y: 0 }] },
    });
  });

  it('memória da névoa: vale a última', () => {
    const last = explored('2');
    expect(mergeBurst([explored('1'), last])).toBe(last);
  });

  it('agrupar os pendentes mantém a tela e os outros pendentes', () => {
    let sync = startSync(base(), 1);
    sync = localCommand(sync, 1, move(10));
    sync = localCommand(sync, 2, rename('Taverna'));
    sync = localCommand(sync, 3, move(30));
    const before = sync.view;
    sync = squashPending(sync, [1, 3], 4, mergeBurst([move(10), move(30)]));
    expect(sync.pending.map((p) => p.seq)).toEqual([2, 4]);
    expect(sync.view).toEqual(before);
  });

  it('agrupar seqs que não estão pendentes não muda nada', () => {
    const sync = localCommand(startSync(base(), 1), 1, move(10));
    expect(squashPending(sync, [7], 8, move(1))).toBe(sync);
  });

  it('controles de volume vão em rajada; outras alterações da ficha, na hora', () => {
    expect(burstKey({ type: 'setSoundMaster', payload: { volume: 0.5 } })).toBe('soundMaster');
    expect(burstKey({ type: 'updateEntry', payload: { entryId: 'a', patch: { volume: 0.5 } } })).toBe('volume:a');
    expect(burstKey({ type: 'updateEntry', payload: { entryId: 'a', patch: { name: 'x' } } })).toBeNull();
    expect(burstKey({ type: 'updateEntry', payload: { entryId: 'a', patch: { volume: 0.5, name: 'x' } } })).toBeNull();
  });
});
