import { existsSync } from 'node:fs';
import WebSocket from 'ws';

/**
 * Teste de fumaça contra o servidor RODANDO (`npm run dev` em outro terminal, depois `npm run seed`).
 * Simula o mestre e a jogadora do seed e mostra, passo a passo, o servidor em ação:
 * login, lista de mesas, WebSocket, projeção (o que cada um recebe), comando permitido,
 * comando recusado, rolagem no servidor e recusa de origem não autorizada.
 */
if (existsSync('.env')) process.loadEnvFile('.env');
const port = process.env['PORT'] ?? '3000';
const base = `http://localhost:${port}`;
const origin = base;
const password = process.env['SEED_PASSWORD'] ?? '';

const ok = (msg: string) => console.log(`  ✔ ${msg}`);
const fail = (msg: string): never => {
  console.error(`  ✘ ${msg}`);
  process.exit(1);
};

/** Faz login e devolve o cookie de sessão (como o navegador guardaria). */
async function login(email: string): Promise<string> {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ login: email, password }),
  });
  if (res.status !== 200) fail(`login de ${email}: HTTP ${res.status} ${await res.text()}`);
  const cookie = res.headers.getSetCookie().find((c) => c.includes('zh_session'));
  if (!cookie) fail('cookie de sessão ausente');
  if (!/HttpOnly/i.test(cookie!) || !/SameSite=Strict/i.test(cookie!)) fail('cookie sem HttpOnly/SameSite');
  return cookie!.split(';')[0];
}

/** Abre o WebSocket da mesa e coleta as mensagens recebidas. */
function connect(tableId: string, cookie: string, wsOrigin = origin): Promise<{ ws: WebSocket; inbox: any[]; next: (t: string) => Promise<any> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/tables/${tableId}`, { headers: { Cookie: cookie, Origin: wsOrigin } });
    const inbox: any[] = [];
    const waiters: { t: string; resolve: (m: any) => void }[] = [];
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      const i = waiters.findIndex((w) => w.t === msg.t);
      if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
      else inbox.push(msg);
    });
    const next = (t: string) =>
      new Promise<any>((res, rej) => {
        const i = inbox.findIndex((m) => m.t === t);
        if (i >= 0) return res(inbox.splice(i, 1)[0]);
        waiters.push({ t, resolve: res });
        setTimeout(() => rej(new Error(`tempo esgotado esperando "${t}"`)), 3000);
      });
    ws.on('open', () => resolve({ ws, inbox, next }));
    ws.on('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.on('error', reject);
  });
}

console.log(`\nTeste de fumaça em ${base}\n`);

const health = await fetch(`${base}/api/health`).catch(() => fail(`servidor não responde em ${base} (rode \`npm run dev\`)`));
if (health.status !== 200) fail('health check');
ok('servidor no ar');

const gmCookie = await login('mestre@zehenia.local');
const playerCookie = await login('jogador@zehenia.local');
ok('login do mestre e da jogadora (cookie HttpOnly + SameSite=Strict)');

const tables = (await (await fetch(`${base}/api/tables`, { headers: { Cookie: gmCookie } })).json()) as { tables: { id: string; name: string }[] };
const table = tables.tables[0] ?? fail('nenhuma mesa (rode `npm run seed`)');
ok(`mesa encontrada: "${table.name}"`);

const csrf = await fetch(`${base}/api/tables`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: gmCookie, Origin: 'https://site-malicioso.example' },
  body: '{}',
});
if (csrf.status !== 403) fail(`CSRF deveria ser recusado (veio ${csrf.status})`);
ok('requisição de outra origem recusada (CSRF): 403');

const evil = await connect(table.id, gmCookie, 'https://site-malicioso.example').then(
  () => fail('WebSocket de outra origem deveria ser recusado'),
  (err: Error) => err.message,
);
ok(`WebSocket de outra origem recusado (CSWSH): ${evil}`);

const gm = await connect(table.id, gmCookie);
const player = await connect(table.id, playerCookie);
const gmWelcome = await gm.next('welcome');
const playerWelcome = await player.next('welcome');
ok(`mestre entrou como "${gmWelcome.you.role}", jogadora como "${playerWelcome.you.role}"`);

const gmNotes = gmWelcome.state.scenes.flatMap((s: any) => s.notes ?? []).length;
const playerNotes = playerWelcome.state.scenes.flatMap((s: any) => s.notes ?? []).length;
console.log(`    mestre recebe ${gmWelcome.state.scenes.length} cenas e ${gmNotes} anotações;`);
console.log(`    jogadora recebe ${playerWelcome.state.scenes.length} cena e ${playerNotes} anotação (sem a secreta e sem a cena em preparação)`);
const goblin = playerWelcome.state.entries.find((e: any) => e.id === 'npc-goblin');
if (goblin?.sheet) fail('a jogadora não deveria receber a ficha do NPC');
if (playerWelcome.state.entries.some((e: any) => e.id === 'act-emboscada')) fail('a jogadora não deveria receber ações do mestre');
ok('projeção: ficha do NPC e ações do mestre não chegam à jogadora');

player.ws.send(JSON.stringify({ t: 'cmd', seq: 1, type: 'moveToken', payload: { placementId: 'tk-lyra', x: 385, y: 315 } }));
const moved = await player.next('ack');
ok(`jogadora moveu o próprio token (versão ${moved.version})`);
const gmSaw = await gm.next('cmd');
ok(`mestre recebeu o comando "${gmSaw.type}" em tempo real`);

player.ws.send(JSON.stringify({ t: 'cmd', seq: 2, type: 'moveToken', payload: { placementId: 'tk-goblin', x: 0, y: 0 } }));
const denied = await player.next('nack');
ok(`jogadora tentou mover o goblin: recusado ("${denied.reason}")`);

player.ws.send(JSON.stringify({ t: 'cmd', seq: 3, type: 'moveToken', payload: { placementId: 'tk-lyra', x: 600, y: 315 } }));
const wall = await player.next('nack');
ok(`jogadora tentou atravessar a parede: recusado ("${wall.reason}")`);

player.ws.send(JSON.stringify({ t: 'cmd', seq: 4, type: 'addChatMessage', payload: { message: { id: 'msg-1', at: 0, userId: 'outra-conta', author: 'Mestre', role: 'gm', text: 'Sou o mestre, confia' } } }));
const chat = await player.next('ack');
ok(`mensagem de chat carimbada pelo servidor: autor "${chat.payload.message.author}", papel "${chat.payload.message.role}"`);

player.ws.send(JSON.stringify({ t: 'roll', seq: 5, sheetId: 'pc-lyra', roll: { dice: '2d12', modifier: 1 }, label: 'Golpe', icon: 'swords' }));
const roll = await player.next('ack');
const r = roll.payload.roll;
ok(`rolagem feita no servidor: ${r.dice} [${r.rolls.join(', ')}] ${r.modifier >= 0 ? '+' : ''}${r.modifier} = ${r.total} (${r.outcome})`);

player.ws.send('isto não é JSON');
const bad = await player.next('error');
ok(`mensagem malformada recusada ("${bad.message}")`);

gm.ws.close();
player.ws.close();
console.log('\nTudo certo.\n');
