import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ORIGIN, PASSWORD, PNG_1X1, call, createTestServer, multipart, openSocket, register, type TestServer } from './helpers';

/**
 * Sala da mesa por WebSocket, com servidor real escutando numa porta livre:
 * abertura (origem, sessão, participação), projeção, comandos, recusas e expulsão.
 */

let server: TestServer;
let port: number;
let gm: { id: string; cookie: string };
let player: { id: string; cookie: string };
let tableId: string;

const scene = { id: 's1', name: 'Cena', gridSize: 70, showGrid: true };

beforeEach(async () => {
  server = await createTestServer();
  await server.app.http.listen({ host: '127.0.0.1', port: 0 });
  port = (server.app.http.server.address() as AddressInfo).port;
  gm = await register(server, 'gm@exemplo.com', 'Mestre');
  player = await register(server, 'p@exemplo.com', 'Jogadora');
  tableId = (await call(server, gm.cookie, 'POST', '/api/tables', { name: 'M', system: '', description: '', maxPlayers: 4, accent: '#4f86f7' })).json().table.id;
  const { code } = (await call(server, gm.cookie, 'POST', `/api/tables/${tableId}/invites`)).json();
  await call(server, player.cookie, 'POST', '/api/invites/accept', { code });
});

afterEach(async () => {
  await server.close();
});

describe('abertura da conexão', () => {
  it('recusa outra origem, sem sessão e quem não é membro', async () => {
    const stranger = await register(server, 'x@exemplo.com');
    await expect(openSocket(port, tableId, gm.cookie, 'https://evil.example')).rejects.toThrow('HTTP 403');
    await expect(openSocket(port, tableId, '')).rejects.toThrow('HTTP 401');
    await expect(openSocket(port, tableId, stranger.cookie)).rejects.toThrow('HTTP 404');
    await expect(openSocket(port, 'mesa-que-nao-existe', gm.cookie)).rejects.toThrow('HTTP 404');
  });

  it('o papel vem da conta: dono = mestre, convidado = jogador', async () => {
    const a = await openSocket(port, tableId, gm.cookie);
    const b = await openSocket(port, tableId, player.cookie);
    expect((await a.next('welcome')).you.role).toBe('gm');
    expect((await b.next('welcome')).you.role).toBe('player');
    a.ws.close();
    b.ws.close();
  });
});

describe('comandos em tempo real', () => {
  it('mestre cria a cena; jogador recebe o estado projetado (sem a anotação secreta)', async () => {
    const a = await openSocket(port, tableId, gm.cookie);
    const b = await openSocket(port, tableId, player.cookie);
    await a.next('welcome');
    await b.next('welcome');

    a.ws.send(JSON.stringify({ t: 'cmd', seq: 1, type: 'addScene', payload: { scene } }));
    expect((await a.next('ack')).version).toBe(1);
    await b.next('state');

    // Anotação secreta: a visão do jogador não muda, então ele nem recebe um estado novo
    const secret = { id: 'n1', x: 0, y: 0, title: 'Armadilha', text: '', color: '#ef4444', gmOnly: true };
    a.ws.send(JSON.stringify({ t: 'cmd', seq: 2, type: 'addNote', payload: { sceneId: 's1', note: secret } }));
    await a.next('ack');
    const visible = { ...secret, id: 'n2', title: 'Placa', gmOnly: false };
    a.ws.send(JSON.stringify({ t: 'cmd', seq: 3, type: 'addNote', payload: { sceneId: 's1', note: visible } }));
    await a.next('ack');
    const view = await b.next('state');
    expect(view.state.scenes[0].notes.map((n: { id: string }) => n.id)).toEqual(['n2']);
    expect(JSON.stringify(b.inbox)).not.toContain('Armadilha');
    a.ws.close();
    b.ws.close();
  });

  it('jogador recebe nack em comando do mestre; o mestre recebe os comandos dos jogadores', async () => {
    const a = await openSocket(port, tableId, gm.cookie);
    const b = await openSocket(port, tableId, player.cookie);
    await a.next('welcome');
    await b.next('welcome');
    b.ws.send(JSON.stringify({ t: 'cmd', seq: 1, type: 'addScene', payload: { scene } }));
    expect((await b.next('nack')).reason).toMatch(/mestre/);

    a.ws.send(JSON.stringify({ t: 'cmd', seq: 1, type: 'addScene', payload: { scene } }));
    await a.next('ack');
    const stroke = { id: 'st1', points: [{ x: 1, y: 1 }], color: '#ffffff', width: 4, opacity: 1 };
    b.ws.send(JSON.stringify({ t: 'cmd', seq: 2, type: 'addStroke', payload: { sceneId: 's1', stroke } }));
    await b.next('ack');
    const seen = await a.next('cmd');
    expect(seen).toMatchObject({ type: 'addStroke', by: player.id });
    a.ws.close();
    b.ws.close();
  });

  it('névoa: o jogador recebe os polígonos de visão, sem paredes nem o NPC escondido', async () => {
    const a = await openSocket(port, tableId, gm.cookie);
    const b = await openSocket(port, tableId, player.cookie);
    await a.next('welcome');
    await b.next('welcome');
    const send = (seq: number, type: string, payload: unknown) => a.ws.send(JSON.stringify({ t: 'cmd', seq, type, payload }));
    const wall = { id: 'w1', kind: 'line', points: [{ x: 300, y: -2000 }, { x: 300, y: 2000 }] };
    send(1, 'addScene', { scene: { ...scene, fog: { enabled: true }, walls: [wall] } });
    send(2, 'addEntry', { entry: { id: 'pc', kind: 'character', name: 'Ana', createdAt: 1, ownerUserId: player.id } });
    send(3, 'addEntry', { entry: { id: 'orc', kind: 'npc', name: 'Orc escondido', createdAt: 1 } });
    send(4, 'placeToken', { sceneId: 's1', placement: { id: 't-pc', entryId: 'pc', x: 100, y: 100 } });
    send(5, 'placeToken', { sceneId: 's1', placement: { id: 't-orc', entryId: 'orc', x: 600, y: 100 } });
    for (let i = 0; i < 5; i++) await a.next('ack');

    // Estados intermediários (agrupados a cada 30 ms) até o último comando chegar
    let view = await b.next('state');
    while (!view.state.scenes[0]?.tokens?.length || view.state.entries.length < 1) view = await b.next('state');
    expect(view.state.scenes[0].tokens.map((t: { id: string }) => t.id)).toEqual(['t-pc']);
    expect(view.vision).toHaveLength(1);
    expect(view.state.scenes[0].walls).toEqual([]);
    expect(JSON.stringify(view)).not.toContain('Orc escondido');

    // O orc entra na visão: o jogador passa a recebê-lo
    send(6, 'moveToken', { placementId: 't-orc', x: 200, y: 100 });
    await a.next('ack');
    const after = await b.next('state');
    expect(after.state.scenes[0].tokens.map((t: { id: string }) => t.id)).toEqual(['t-pc', 't-orc']);
    a.ws.close();
    b.ws.close();
  });

  it('o estado é gravado e volta ao reconectar', async () => {
    const a = await openSocket(port, tableId, gm.cookie);
    await a.next('welcome');
    a.ws.send(JSON.stringify({ t: 'cmd', seq: 1, type: 'addScene', payload: { scene } }));
    await a.next('ack');
    a.ws.close();
    await a.closed;
    const again = await openSocket(port, tableId, gm.cookie);
    const welcome = await again.next('welcome');
    expect(welcome.version).toBe(1);
    expect(welcome.state.scenes[0].name).toBe('Cena');
    again.ws.close();
  });

  it('o mestre muda o mundo: o jogador é avisado e lê a Lore de novo, sem ver o que não foi revelado', async () => {
    const worldId = server.ctx.tables.findForMember(tableId, gm.id)!.worldId;
    const item = (id: string, type: string, parentId: string | null, name: string) => ({ id, type, parentId, name, createdAt: 1, updatedAt: 1 });
    const put = (it: ReturnType<typeof item>) => call(server, gm.cookie, 'PUT', `/api/worlds/${worldId}/items/${it.id}`, it);
    expect((await put(item('pasta', 'folder', null, 'Pública'))).statusCode).toBe(200);
    await put(item('segredo', 'document', null, 'Plano'));

    const a = await openSocket(port, tableId, gm.cookie);
    const b = await openSocket(port, tableId, player.cookie);
    await a.next('welcome');
    await b.next('welcome');
    a.ws.send(JSON.stringify({ t: 'cmd', seq: 1, type: 'toggleLoreReveal', payload: { folderId: 'pasta' } }));
    await a.next('ack');

    await put(item('doc', 'document', 'pasta', 'Crônica'));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('sem aviso do mundo')), 3000);
      b.ws.on('message', (data) => {
        if (JSON.parse(data.toString()).t === 'world') (clearTimeout(timer), resolve());
      });
    });
    const lore = (await call(server, player.cookie, 'GET', `/api/tables/${tableId}/lore`)).json().items;
    expect(lore.map((i: { id: string }) => i.id).sort()).toEqual(['doc', 'pasta']);
    a.ws.close();
    b.ws.close();
  });

  it('rota do NPC controlado: jogador sem controle recebe 403; o mundo de outra pessoa continua fechado', async () => {
    const worldId = server.ctx.tables.findForMember(tableId, gm.id)!.worldId;
    const npc = { id: 'lobo', type: 'npc', parentId: null, name: 'Lobo', createdAt: 1, updatedAt: 1 };
    await call(server, gm.cookie, 'PUT', `/api/worlds/${worldId}/items/lobo`, npc);
    const url = `/api/tables/${tableId}/npcs/lobo`;
    expect((await call(server, player.cookie, 'PATCH', url, { tags: [] })).statusCode).toBe(403);
    expect((await call(server, player.cookie, 'PUT', `/api/worlds/${worldId}/items/lobo`, { ...npc, name: 'Hackeado' })).statusCode).toBe(404);

    const a = await openSocket(port, tableId, gm.cookie);
    await a.next('welcome');
    a.ws.send(JSON.stringify({ t: 'cmd', seq: 1, type: 'addEntry', payload: { entry: { id: 'ref', kind: 'npc', name: 'Lobo', createdAt: 1, worldNpcId: 'lobo', controllerUserId: player.id } } }));
    await a.next('ack');
    const tag = { id: 't1', text: 'Feroz', color: '#ff0000' };
    const saved = await call(server, player.cookie, 'PATCH', url, { tags: [tag] });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().item.token.tags).toEqual([tag]);
    expect(saved.json().item.name).toBe('Lobo');
    expect((await call(server, player.cookie, 'PATCH', url, { name: 'Outro' })).statusCode).toBe(400);
    a.ws.close();
  });

  it('ping e efeito de um chegam ao outro, sem virar estado; efeito desconhecido é recusado', async () => {
    const a = await openSocket(port, tableId, gm.cookie);
    const b = await openSocket(port, tableId, player.cookie);
    await a.next('welcome');
    await b.next('welcome');
    a.ws.send(JSON.stringify({ t: 'cmd', seq: 1, type: 'addScene', payload: { scene } }));
    const { version } = await a.next('ack');
    await b.next('state');

    b.ws.send(JSON.stringify({ t: 'event', event: { kind: 'ping', sceneId: 's1', x: 5, y: 6 } }));
    expect((await a.next('event')).event).toMatchObject({ kind: 'ping', x: 5, y: 6 });

    const fx = { kind: 'explosion', color: '#ff0000', from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, seed: 7, scale: 1 };
    a.ws.send(JSON.stringify({ t: 'event', event: { kind: 'fx', sceneId: 's1', fx } }));
    expect((await b.next('event')).event.fx).toEqual(fx);

    a.ws.send(JSON.stringify({ t: 'event', event: { kind: 'fx', sceneId: 's1', fx: { ...fx, kind: 'naoExiste' } } }));
    expect((await a.next('error')).code).toBe('invalid');
    // Efêmero: a versão da mesa não muda
    expect(server.app.hub.viewOf(tableId, server.ctx.tables.findForMember(tableId, gm.id)!.worldId, { role: 'gm', userId: gm.id }).state.scenes[0].drawings ?? []).toEqual([]);
    a.ws.send(JSON.stringify({ t: 'sync' }));
    expect((await a.next('state')).version).toBe(version);
    a.ws.close();
    b.ws.close();
  });

  it('rolagem no servidor aparece no chat de todos', async () => {
    const a = await openSocket(port, tableId, gm.cookie);
    const b = await openSocket(port, tableId, player.cookie);
    await a.next('welcome');
    await b.next('welcome');
    b.ws.send(JSON.stringify({ t: 'roll', seq: 7, roll: { dice: '3d6', modifier: 0 }, label: 'Sorte', icon: 'casino' }));
    const ack = await b.next('ack');
    expect(ack.payload.roll.rolls).toHaveLength(3);
    const cmd = await a.next('cmd');
    expect(cmd.type).toBe('addChatMessage');
    expect(cmd.payload.message.roll.total).toBe(ack.payload.roll.total);
    a.ws.close();
    b.ws.close();
  });
});

describe('LGPD: exportar e excluir a conta', () => {
  const character = (id: string, name: string, ownerUserId: string) => ({ id, kind: 'character', name, createdAt: 1, ownerUserId });
  const cmd = (seq: number, type: string, payload: unknown) => JSON.stringify({ t: 'cmd', seq, type, payload });

  it('exporta os dados da conta, sem senha e sem os dados de outras pessoas', async () => {
    const a = await openSocket(port, tableId, gm.cookie);
    const b = await openSocket(port, tableId, player.cookie);
    await a.next('welcome');
    await b.next('welcome');
    b.ws.send(cmd(1, 'addEntry', { entry: character('pc-p', 'Heroína', player.id) }));
    await b.next('ack');
    a.ws.send(cmd(1, 'addEntry', { entry: character('pc-x', 'Ficha de outra pessoa', 'outra-conta') }));
    await a.next('ack');

    const res = await call(server, player.cookie, 'GET', '/api/auth/me/export');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    const data = res.json();
    expect(data.user.email).toBe('p@exemplo.com');
    expect(data.worlds).toHaveLength(1);
    expect(data.tables.joined[0].characters.map((c: { id: string }) => c.id)).toEqual(['pc-p']);
    expect(res.body).not.toMatch(/password|Ficha de outra pessoa/);
    a.ws.close();
    b.ws.close();
  });

  it('excluir a conta pede a senha e apaga tudo dela, inclusive as fichas nas mesas de outros', async () => {
    const a = await openSocket(port, tableId, gm.cookie);
    const b = await openSocket(port, tableId, player.cookie);
    await a.next('welcome');
    await b.next('welcome');
    b.ws.send(cmd(1, 'addEntry', { entry: character('pc-p', 'Heroína', player.id) }));
    await b.next('ack');
    await a.next('cmd');
    // Mesa própria da jogadora, com um arquivo
    const own = (await call(server, player.cookie, 'POST', '/api/tables', { name: 'Minha', system: '', description: '', maxPlayers: 2, accent: '#4f86f7' })).json().table;
    const form = multipart(PNG_1X1);
    const headers = { cookie: player.cookie, origin: ORIGIN, 'content-type': form.contentType };
    const file = (await server.app.http.inject({ method: 'POST', url: `/api/files?tableId=${own.id}`, headers, payload: form.body })).json().file;
    expect(existsSync(join(server.config.FILES_DIR, file.id))).toBe(true);

    expect((await call(server, player.cookie, 'DELETE', '/api/auth/me', { password: 'senha errada aqui' })).statusCode).toBe(401);
    expect((await call(server, player.cookie, 'DELETE', '/api/auth/me', { password: PASSWORD })).statusCode).toBe(204);

    expect((await b.closed).code).toBe(4401);
    expect(await a.next('cmd')).toMatchObject({ type: 'removeEntry', payload: { entryId: 'pc-p' }, by: 'servidor' });
    expect(server.ctx.tables.find(own.id)).toBeNull();
    expect(existsSync(join(server.config.FILES_DIR, file.id))).toBe(false);
    expect(server.ctx.users.findById(player.id)).toBeNull();
    expect((await call(server, player.cookie, 'GET', '/api/auth/me')).statusCode).toBe(401);
    a.ws.close();
  });
});

describe('mensagens inválidas e expulsão', () => {
  it('JSON malformado, chave de protótipo e tipo desconhecido = erro; binário fecha', async () => {
    const a = await openSocket(port, tableId, gm.cookie);
    await a.next('welcome');
    a.ws.send('{não é json');
    expect((await a.next('error')).code).toBe('invalid');
    a.ws.send('{"t":"cmd","seq":1,"type":"addScene","payload":{"__proto__":{"x":1}}}');
    expect((await a.next('error')).code).toBe('invalid');
    a.ws.send(JSON.stringify({ t: 'cmd', seq: 1, type: 'constructor', payload: {} }));
    expect((await a.next('error')).code).toBe('invalid');
    a.ws.send(Buffer.from([1, 2, 3]), { binary: true });
    expect((await a.closed).code).toBe(1008);
  });

  it('mensagem acima de 512 KB derruba a conexão', async () => {
    const a = await openSocket(port, tableId, gm.cookie);
    await a.next('welcome');
    a.ws.send(JSON.stringify({ t: 'sync', pad: 'x'.repeat(600 * 1024) }));
    expect((await a.closed).code).toBe(1009);
  });

  it('cada tipo de mensagem tem o próprio limite de tamanho, bem abaixo do teto', async () => {
    const a = await openSocket(port, tableId, gm.cookie);
    await a.next('welcome');
    // JSON válido (espaços são permitidos), mas 20 KB num pedido de "sync"
    a.ws.send(`{"t":"sync"${' '.repeat(20 * 1024)}}`);
    expect((await a.next('error')).code).toBe('too_big');
    a.ws.close();
  });

  it('mensagens inválidas intercaladas com válidas não enganam o limite', async () => {
    const a = await openSocket(port, tableId, gm.cookie);
    await a.next('welcome');
    for (let i = 0; i < 25; i++) {
      a.ws.send('{não é json');
      a.ws.send('{"t":"sync"}');
    }
    expect((await a.closed).code).toBe(1008);
  });

  it('logout e troca de senha derrubam o WebSocket na hora (sem esperar o ping)', async () => {
    const b = await openSocket(port, tableId, player.cookie);
    await b.next('welcome');
    await call(server, player.cookie, 'POST', '/api/auth/logout');
    expect((await b.closed).code).toBe(4401);

    const a = await openSocket(port, tableId, gm.cookie);
    await a.next('welcome');
    await call(server, gm.cookie, 'POST', '/api/auth/password', { current: PASSWORD, next: 'outra senha bem longa' });
    expect((await a.closed).code).toBe(4401);
  });

  it('jogador removido da mesa é desconectado na hora', async () => {
    const b = await openSocket(port, tableId, player.cookie);
    await b.next('welcome');
    await call(server, gm.cookie, 'DELETE', `/api/tables/${tableId}/members/${player.id}`);
    expect((await b.closed).code).toBe(4403);
  });

  it('mesa excluída fecha a sala', async () => {
    const a = await openSocket(port, tableId, gm.cookie);
    await a.next('welcome');
    await call(server, gm.cookie, 'DELETE', `/api/tables/${tableId}`);
    expect((await a.closed).code).toBe(4404);
  });
});
