// Página de testes do servidor (só com DEV_TOOLS=true).
// Tudo é escrito com textContent (nunca innerHTML): mensagens vindas do servidor não viram HTML.

const $ = (id) => document.getElementById(id);
let selectedTable = null;
let ws = null;
let seq = 1;
let lastState = null;

// --- Registro de mensagens ---------------------------------------------------

function log(direction, data) {
  const li = document.createElement('li');
  li.className = direction;
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  li.textContent = `${new Date().toLocaleTimeString()} ${direction === 'out' ? '→' : direction === 'err' ? '✘' : '←'} ${text.length > 2000 ? text.slice(0, 2000) + '…' : text}`;
  $('log').prepend(li);
}

function showState(state) {
  lastState = state;
  $('state').textContent = JSON.stringify(state, null, 2);
}

// --- HTTP ----------------------------------------------------------------------

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    log('err', `${method} ${path} → ${res.status} ${data?.error ?? ''} ${data?.details ? JSON.stringify(data.details) : ''}`);
    throw new Error(data?.error ?? res.statusText);
  }
  return data;
}

async function refreshMe() {
  try {
    const { user } = await api('GET', '/api/auth/me');
    $('who').textContent = `Logado: ${user.name} <${user.email}>`;
  } catch {
    $('who').textContent = 'Não logado';
  }
}

async function listTables() {
  const { tables } = await api('GET', '/api/tables');
  const ul = $('tables');
  ul.replaceChildren();
  for (const t of tables) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.textContent = `${t.name} — você é ${t.role === 'gm' ? 'mestre' : 'jogador'}`;
    if (selectedTable?.id === t.id) btn.classList.add('selected');
    btn.addEventListener('click', () => {
      selectedTable = t;
      listTables();
    });
    li.append(btn);
    ul.append(li);
  }
  if (!tables.length) ul.textContent = 'Nenhuma mesa.';
}

// --- WebSocket ------------------------------------------------------------------

function send(message) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return log('err', 'conecte numa mesa primeiro');
  ws.send(JSON.stringify(message));
  log('out', message);
}

function connect() {
  if (!selectedTable) return log('err', 'selecione uma mesa');
  ws?.close();
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/tables/${selectedTable.id}`;
  ws = new WebSocket(url);
  ws.addEventListener('open', () => {
    $('ws-status').textContent = 'conectado';
    $('ws-status').classList.add('on');
  });
  ws.addEventListener('close', (e) => {
    $('ws-status').textContent = `desconectado (${e.code}${e.reason ? ': ' + e.reason : ''})`;
    $('ws-status').classList.remove('on');
  });
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    log(msg.t === 'nack' || msg.t === 'error' ? 'err' : 'in', msg);
    if (msg.t === 'welcome' || msg.t === 'state') showState(msg.state);
  });
}

// --- Botões ----------------------------------------------------------------------

const credentials = () => ({ email: $('email').value, password: $('password').value });

$('login').addEventListener('click', async () => {
  await api('POST', '/api/auth/login', credentials());
  await refreshMe();
  await listTables();
});
$('logout').addEventListener('click', async () => {
  await api('POST', '/api/auth/logout');
  ws?.close();
  await refreshMe();
});
$('list-tables').addEventListener('click', listTables);
$('create-table').addEventListener('click', async () => {
  await api('POST', '/api/tables', { name: 'Mesa nova', system: '', description: '', maxPlayers: 4, accent: '#4f86f7' });
  await listTables();
});
$('invite').addEventListener('click', async () => {
  if (!selectedTable) return log('err', 'selecione uma mesa');
  const { code } = await api('POST', `/api/tables/${selectedTable.id}/invites`);
  $('invite-code').value = code;
  log('in', `convite gerado (válido por 7 dias): ${code}`);
});
$('accept').addEventListener('click', async () => {
  await api('POST', '/api/invites/accept', { code: $('invite-code').value.trim() });
  await listTables();
});
$('connect').addEventListener('click', connect);
$('disconnect').addEventListener('click', () => ws?.close());
$('send-sync').addEventListener('click', () => send({ t: 'sync' }));
$('send-chat').addEventListener('click', () =>
  send({ t: 'cmd', seq: seq++, type: 'addChatMessage', payload: { message: { id: crypto.randomUUID(), at: 0, userId: '', author: '', role: 'player', text: 'Olá da página de testes!' } } }),
);
$('send-roll').addEventListener('click', () => send({ t: 'roll', seq: seq++, roll: { dice: '2d12', modifier: 0 }, label: 'Teste', icon: 'casino' }));
$('send-move').addEventListener('click', () => {
  const scene = lastState?.scenes?.find((s) => s.id === lastState.activeSceneId);
  const token = scene?.tokens?.[0];
  if (!token) return log('err', 'nenhum token na cena aberta (use "sync")');
  send({ t: 'cmd', seq: seq++, type: 'moveToken', payload: { placementId: token.id, x: token.x + 70, y: token.y } });
});
$('send-raw').addEventListener('click', () => {
  try {
    send(JSON.parse($('raw').value));
  } catch {
    log('err', 'JSON inválido');
  }
});
$('clear-log').addEventListener('click', () => $('log').replaceChildren());

refreshMe().then(() => listTables().catch(() => undefined));
