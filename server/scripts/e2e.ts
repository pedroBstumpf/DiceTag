import { randomBytes } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Teste de ponta a ponta com o app de verdade: dois navegadores isolados (mestre e jogadora, cada um
 * com a própria conta) na mesma mesa online, como duas pessoas em máquinas diferentes.
 *
 *   npm run build            # na raiz: o servidor entrega o app compilado
 *   npm run e2e              # na pasta server/
 *
 * Inicia o app pelo mesmo caminho do dia a dia (`npm run mesa`, com o servidor preso à pasta do app e
 * um Tailscale de mentira), numa porta própria e numa pasta TEMPORÁRIA: não toca na sua pasta nem usa
 * os seus segredos. Controla o Chrome pelo protocolo de depuração, com o WebSocket e o fetch do próprio
 * Node (sem pacote novo). Chrome em outro lugar: variável CHROME_PATH.
 */

const PORT = 3177;
const BASE = `http://localhost:${PORT}`;
const CDP_PORT = 9333;
const FRONTEND = resolve('../dist/zehenia/browser');
const PASSWORD = randomBytes(12).toString('base64url');
const work = mkdtempSync(join(tmpdir(), 'zehenia-e2e-'));
const HOME = join(work, 'pasta-do-app');
const OWNER_EMAIL = 'dono@exemplo.com';
/** Ambiente dos comandos do app: a pasta temporária e o Tailscale de mentira. */
const APP_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  ZEHENIA_HOME: HOME,
  MESA_PORT: String(PORT),
  TAILSCALE_ARGV: JSON.stringify([process.execPath, resolve('scripts/lib/tailscale-falso.mjs')]),
  DONO_NOME: 'Mestre Teste',
  DONO_EMAIL: OWNER_EMAIL,
  DONO_SENHA: PASSWORD,
};

// --- Resultado ------------------------------------------------------------------------

let failures = 0;
const check = (ok: boolean, label: string, detail = ''): void => {
  console.log(`  ${ok ? '✔' : '✘'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const section = (title: string): void => console.log(`\n${title}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Servidor --------------------------------------------------------------------------

let serverLog = '';
let server: ChildProcess | undefined;

/** Inicia o app como no dia a dia: `npm run mesa`. Reiniciar usa os mesmos dados e segredos. */
function startServer(): Promise<void> {
  server = spawn(process.execPath, ['--import', 'tsx', '--disable-warning=ExperimentalWarning', 'scripts/mesa.ts', '--sem-abrir', '--sem-build'], {
    env: APP_ENV,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout?.on('data', (d: Buffer) => (serverLog += d.toString()));
  server.stderr?.on('data', (d: Buffer) => (serverLog += d.toString()));
  return until(async () => (await fetch(`${BASE}/api/health`).catch(() => null))?.ok === true, 'servidor no ar', 40_000);
}

async function until(test: () => Promise<boolean> | boolean, label: string, timeout = 8000): Promise<void> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await test()) return;
    await sleep(100);
  }
  throw new Error(`tempo esgotado: ${label}`);
}

// --- Chrome (protocolo de depuração) ------------------------------------------------------

class Cdp {
  private id = 0;
  private readonly waiting = new Map<number, (message: any) => void>();
  private constructor(private readonly ws: WebSocket) {
    ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.waiting.has(message.id)) {
        this.waiting.get(message.id)!(message);
        this.waiting.delete(message.id);
      }
    };
  }

  static async open(url: string): Promise<Cdp> {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    return new Cdp(ws);
  }

  send(method: string, params: object = {}, sessionId?: string): Promise<any> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, (message) => (message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result)));
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
    });
  }

  close(): void {
    this.ws.close();
  }
}

/** Uma aba num contexto isolado (cookies e IndexedDB próprios): uma "máquina". */
class Page {
  constructor(
    private readonly cdp: Cdp,
    private readonly session: string,
  ) {}

  static async open(cdp: Cdp): Promise<Page> {
    const { browserContextId } = await cdp.send('Target.createBrowserContext');
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId, width: 1400, height: 900 });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(cdp, sessionId);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('DOM.enable');
    // Registro do que acontece entre as verificações: pings, efeitos e áudios que apareceram e sumiram
    await page.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        window.__audios = [];
        const originalPlay = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function () {
          if (!window.__audios.includes(this)) window.__audios.push(this);
          return originalPlay.call(this);
        };
        window.__seen = { ping: 0, fx: 0 };
        addEventListener('DOMContentLoaded', () => {
          new MutationObserver((records) => {
            for (const record of records) for (const node of record.addedNodes) {
              if (node.nodeType !== 1) continue;
              if (node.matches?.('.animate-ping-once') || node.querySelector?.('.animate-ping-once')) window.__seen.ping++;
              if (node.closest?.('app-fx-layer') && node.tagName?.toLowerCase() !== 'svg') window.__seen.fx++;
            }
          }).observe(document.documentElement, { childList: true, subtree: true });
        });
      `,
    });
    return page;
  }

  send(method: string, params: object = {}): Promise<any> {
    return this.cdp.send(method, params, this.session);
  }

  async goto(url: string): Promise<void> {
    await this.send('Page.navigate', { url });
    await sleep(600);
    await until(() => this.eval('document.readyState === "complete"'), `carregar ${url}`);
  }

  async eval<T = any>(expression: string): Promise<T> {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: false });
    if (exceptionDetails) throw new Error(`${exceptionDetails.exception?.description ?? exceptionDetails.text}\n  em: ${expression.slice(0, 200)}`);
    return result.value as T;
  }

  /** Chamada à API a partir da página (com o cookie e a origem dela), como o app faz. */
  api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    return this.eval<T>(`fetch('/api${path}', { method: '${method}', ${body === undefined ? '' : `headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))},`} })
      .then(async (r) => { const text = await r.text(); let data = null; try { data = JSON.parse(text); } catch {} return { status: r.status, ...data }; })`);
  }

  text(): Promise<string> {
    return this.eval('document.body.innerText');
  }

  async waitText(fragment: string, timeout = 8000): Promise<boolean> {
    return until(async () => (await this.text()).includes(fragment), fragment, timeout).then(
      () => true,
      () => false,
    );
  }

  /** Clique de verdade (o navegador conta como interação da pessoa) no centro de um elemento. */
  async clickAt(x: number, y: number): Promise<void> {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  }

  async drag(from: [number, number], to: [number, number]): Promise<void> {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from[0], y: from[1] });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from[0], y: from[1], button: 'left', buttons: 1, clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: to[0], y: to[1], buttons: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to[0], y: to[1], button: 'left', buttons: 0, clickCount: 1 });
  }

  async press(key: string): Promise<void> {
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key, text: key });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key });
  }

  /** Clica no botão pelo `aria-label` ou pelo texto; false = não achou. */
  clickButton(label: string): Promise<boolean> {
    return this.eval(`(() => {
      const list = [...document.querySelectorAll('button, a, [role="tab"], [role="menuitem"]')];
      const el = list.find((b) => b.getAttribute('aria-label') === ${JSON.stringify(label)} || b.innerText?.trim() === ${JSON.stringify(label)})
        ?? list.find((b) => b.innerText?.includes(${JSON.stringify(label)}));
      if (!el) return false;
      el.click();
      return true;
    })()`);
  }

  /** Preenche o campo pelo texto do rótulo ou pelo seletor. */
  fill(selector: string, value: string): Promise<boolean> {
    return this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.focus();
      el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
  }

  async screenshot(file: string): Promise<void> {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(file, Buffer.from(data, 'base64'));
  }

  /** Abre a sala por um WebSocket à parte, na própria página, para arrumar a cena do teste. */
  async openRoom(tableId: string): Promise<void> {
    await this.eval(`new Promise((resolve, reject) => {
      const ws = new WebSocket(location.origin.replace('http', 'ws') + '/ws/tables/${tableId}');
      window.__room = ws;
      window.__replies = [];
      window.__seq = 1000;
      ws.onmessage = (e) => window.__replies.push(JSON.parse(e.data));
      ws.onerror = reject;
      const wait = () => (window.__replies.some((m) => m.t === 'welcome') ? resolve(true) : setTimeout(wait, 30));
      ws.onopen = wait;
    })`);
  }

  /** Comando pela sala; devolve o `ack` ou o `nack`. */
  command(type: string, payload: unknown): Promise<any> {
    return this.eval(`new Promise((resolve, reject) => {
      const seq = ++window.__seq;
      window.__room.send(JSON.stringify({ t: 'cmd', seq, type: ${JSON.stringify(type)}, payload: ${JSON.stringify(payload)} }));
      const end = Date.now() + 4000;
      const wait = () => {
        const reply = window.__replies.find((m) => m.seq === seq);
        if (reply) return resolve(reply);
        Date.now() > end ? reject(new Error('sem resposta para ${type}')) : setTimeout(wait, 20);
      };
      wait();
    })`);
  }

  roll(message: object): Promise<any> {
    return this.eval(`new Promise((resolve, reject) => {
      const seq = ++window.__seq;
      window.__room.send(JSON.stringify({ t: 'roll', seq, ...${JSON.stringify(message)} }));
      const end = Date.now() + 4000;
      const wait = () => {
        const reply = window.__replies.find((m) => m.seq === seq);
        if (reply) return resolve(reply);
        Date.now() > end ? reject(new Error('sem resposta da rolagem')) : setTimeout(wait, 20);
      };
      wait();
    })`);
  }

  /** Envia um arquivo gerado na página para a API de arquivos. `build`: expressão que dá um Blob. */
  upload(query: string, build: string, name: string): Promise<any> {
    return this.eval(`(async () => {
      const form = new FormData();
      form.append('file', ${build}, ${JSON.stringify(name)});
      const res = await fetch('/api/files?${query}', { method: 'POST', body: form });
      return { status: res.status, ...(await res.json()) };
    })()`);
  }
}

// --- Arquivos de teste ------------------------------------------------------------------

/** JPEG 1×1 válido com um EXIF que leva a "localização" (texto reconhecível nos bytes). */
function jpegWithExif(): Buffer {
  const pixel = Buffer.from(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
    'base64',
  );
  const marker = Buffer.from('GPS-LOCALIZACAO-SECRETA');
  // Exif\0\0 + TIFF com a orientação 6 + o marcador
  const tiff = Buffer.from([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0]);
  const data = Buffer.concat([Buffer.from('Exif\0\0'), tiff, marker]);
  const length = data.length + 2;
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, length >> 8, length & 0xff]), data]);
  return Buffer.concat([pixel.subarray(0, 2), app1, pixel.subarray(2)]);
}

/** Capturas de tela para conferir o visual, se E2E_SHOTS disser onde guardar. */
async function shot(page: Page, name: string): Promise<void> {
  if (process.env['E2E_SHOTS']) await page.screenshot(join(process.env['E2E_SHOTS'], `${name}.png`));
}

/** WAV de 2 s de silêncio: o suficiente para o navegador tocar e sabermos o ponto da faixa. */
const SILENT_WAV = `(() => {
  const rate = 8000, seconds = 30, size = rate * seconds;
  const buf = new ArrayBuffer(44 + size); const v = new DataView(buf);
  const put = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  put(0, 'RIFF'); v.setUint32(4, 36 + size, true); put(8, 'WAVE'); put(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate, true);
  v.setUint16(32, 1, true); v.setUint16(34, 8, true); put(36, 'data'); v.setUint32(40, size, true);
  new Uint8Array(buf, 44).fill(128);
  return new Blob([buf], { type: 'audio/wav' });
})()`;

/** PNG 1×1, para as imagens do mundo. */
const PNG_BLOB = `new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))], { type: 'image/png' })`;

// --- O teste ---------------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!existsSync(join(FRONTEND, 'index.html'))) throw new Error('Rode `npm run build` na raiz antes: o servidor entrega o app compilado.');
  const chromePath = process.env['CHROME_PATH'] ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
  if (!chromePath) throw new Error('Chrome não encontrado: defina CHROME_PATH.');

  await startServer();
  const chrome = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${join(work, 'chrome')}`, '--no-first-run', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
  try {
    let wsUrl = '';
    await until(async () => {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).catch(() => null);
      if (!res?.ok) return false;
      wsUrl = ((await res.json()) as { webSocketDebuggerUrl: string }).webSocketDebuggerUrl;
      return true;
    }, 'Chrome no ar', 20_000);
    const cdp = await Cdp.open(wsUrl);
    const gm = await Page.open(cdp);
    const player = await Page.open(cdp);
    await run(gm, player, cdp);
    cdp.close();
  } finally {
    chrome.kill();
  }
}

async function run(gm: Page, player: Page, cdp: Cdp): Promise<void> {
  section('Só por convite');
  const visitor = await Page.open(cdp);
  await visitor.goto(`${BASE}/mesas`);
  check(await visitor.waitText('Entrada do dono'), 'sem conta, qualquer página leva à entrada');
  await shot(visitor, 'entrada');
  const entrance = await visitor.text();
  check(!/criar conta|cadastr/i.test(entrance), 'não há cadastro em lugar nenhum');
  const register = await visitor.eval<number>(`fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'X', email: 'x@exemplo.com', password: 'uma senha qualquer' }) }).then((r) => r.status)`);
  check(register === 404, 'a rota de cadastro não existe');

  await gm.goto(`${BASE}/entrar`);
  await until(() => gm.fill('input[formcontrolname="email"]', OWNER_EMAIL), 'campo de e-mail');
  await gm.fill('input[formcontrolname="password"]', PASSWORD);
  await gm.clickButton('Entrar');
  check(await gm.waitText('Minhas mesas', 15_000), 'o dono entra com a senha criada no terminal');
  const gmAccount = await gm.api('GET', '/auth/me');
  check(gmAccount.user?.kind === 'owner', 'a conta é a do dono');

  await gm.goto(`${BASE}/mesas`);
  const { table } = await gm.api('POST', '/tables', { name: 'Mesa E2E', system: '', description: '', maxPlayers: 4, accent: '#4f86f7' });
  const invited = await gm.api('POST', `/tables/${table.id}/invites`);
  check(invited.link.includes('/convite#codigo='), 'o convite vem como link, com o código depois do #');
  await player.goto(`${BASE}/convite#codigo=${invited.code}`);
  check(!(await player.eval<string>('location.href')).includes('codigo'), 'o código sai da barra de endereço ao abrir');
  await until(() => player.fill('input[autocomplete="nickname"]', 'Jogadora Teste'), 'campo de nome');
  await shot(player, 'convite');
  await player.clickButton('Entrar na mesa');
  check(await player.waitText('Online', 15_000), 'a amiga entra só com o nome, sem cadastro nem senha, direto na mesa');
  const playerAccount = await player.api('GET', '/auth/me');
  check(playerAccount.user?.kind === 'guest' && playerAccount.user.email === '' && !!playerAccount.user.id, 'ela tem uma conta com nome e id, sem e-mail');
  await visitor.goto(`${BASE}/convite#codigo=${invited.code}`);
  await until(() => visitor.fill('input[autocomplete="nickname"]', 'Intruso'), 'campo de nome');
  await visitor.clickButton('Entrar na mesa');
  check(await visitor.waitText('inválido, vencido ou já usado'), 'o mesmo link não serve para mais ninguém');
  const worldId: string = table.worldId;

  section('O que o convidado não alcança');
  await player.goto(`${BASE}/arquivos`);
  check(await player.waitText('As mesas para as quais você foi convidado'), 'a página Arquivos leva o convidado de volta às mesas dele');
  const menu = await player.text();
  check(!menu.includes('Arquivos') && !menu.includes('Worldbuild'), 'o menu dele só tem as mesas');
  check((await player.api('POST', '/tables', { name: 'X', system: '', description: '', maxPlayers: 4, accent: '#4f86f7' })).status === 403, 'ele não cria mesas');
  check((await player.api('GET', '/library')).status === 403, 'ele não vê a biblioteca');
  check((await player.api('POST', '/host/open')).status === 403, 'ele não abre nem fecha a mesa');
  check((await player.api('GET', `/worlds/${worldId}/items`)).status === 404, 'ele não lê o mundo do mestre');

  section('Biblioteca de arquivos, presa à pasta');
  const library = join(HOME, 'biblioteca');
  await gm.goto(`${BASE}/arquivos`);
  check(await gm.waitText('O app só tem acesso a esta pasta'), 'a página Arquivos mostra a pasta do computador');
  check(await gm.waitText('Proteção do sistema ativa'), 'com a proteção do sistema ligada');
  // Colocado direto na pasta, sem passar pelo app
  mkdirSync(join(library, 'imagens', 'Mapas'), { recursive: true });
  writeFileSync(join(library, 'imagens', 'Mapas', 'ponte.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
  await gm.goto(`${BASE}/arquivos`);
  check(await gm.waitText('Mapas'), 'a pasta criada no Explorador aparece no app');
  await gm.clickButton('Abrir a pasta Mapas');
  check(await gm.waitText('ponte.png'), 'e o arquivo dentro dela, com a pré-visualização');
  const thumb = await until(() => gm.eval(`[...document.querySelectorAll('app-library img')].some((i) => i.naturalWidth > 0)`), 'miniatura', 5000).then(
    () => true,
    () => false,
  );
  check(thumb, 'a imagem carrega');
  const sent = await gm.eval<{ status: number }>(`(async () => {
    const form = new FormData();
    form.append('file', ${PNG_BLOB}, 'enviada.png');
    const res = await fetch('/api/library/files?folder=' + encodeURIComponent('imagens/Mapas'), { method: 'POST', body: form });
    return { status: res.status };
  })()`);
  check(sent.status === 201 && existsSync(join(library, 'imagens', 'Mapas', 'enviada.png')), 'o que é enviado pelo app vai para a pasta real');
  const secrets = readFileSync(join(HOME, 'segredos.env'), 'utf8');
  const secretValue = secrets.split('TOKEN_SECRET=')[1].split(/\r?\n/)[0];
  for (const attempt of ['../segredos.env', '..\\segredos.env', 'imagens/../../segredos.env', '../dados/zehenia.db', 'C:/Windows/win.ini']) {
    const res = await gm.eval<{ status: number; body: string }>(`fetch('/api/library/file?path=' + encodeURIComponent(${JSON.stringify(attempt)})).then(async (r) => ({ status: r.status, body: await r.text() }))`);
    check(res.status === 400 && !res.body.includes(secretValue), `recusa ${attempt}`, String(res.status));
  }
  // O sistema também recusa: o mesmo modelo de permissões do servidor, rodando esta sondagem
  const probePath = join(resolve('.mesa'), 'sondagem.mjs');
  writeFileSync(probePath, `
    import { readFileSync, writeFileSync } from 'node:fs';
    import { execSync } from 'node:child_process';
    const attempt = (name, fn) => { try { fn(); console.log(name + '=PERMITIDO'); } catch (e) { console.log(name + '=' + e.code); } };
    attempt('fora', () => readFileSync(process.argv[2]));
    attempt('repositorio', () => readFileSync(process.argv[3]));
    attempt('gravar', () => writeFileSync(process.argv[4], 'x'));
    attempt('programa', () => execSync('whoami'));
    attempt('dentro', () => readFileSync(process.argv[5]));
  `);
  const { sandboxArgs } = await import('./lib/app-env.js').catch(() => import('./lib/app-env'));
  void sandboxArgs;
  const outside = join(work, 'fora-da-pasta.txt');
  writeFileSync(outside, 'segredo');
  const probe = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/lib/sondar.ts', probePath, outside, resolve('../README.md'), join(work, 'gravado.txt'), join(HOME, 'segredos.env')], { env: APP_ENV, encoding: 'utf8' });
  const results = probe.stdout;
  check(results.includes('fora=ERR_ACCESS_DENIED'), 'pelo sistema: o servidor não lê fora da pasta', results);
  check(results.includes('repositorio=ERR_ACCESS_DENIED'), 'pelo sistema: nem este repositório');
  check(results.includes('gravar=ERR_ACCESS_DENIED') && !existsSync(join(work, 'gravado.txt')), 'pelo sistema: não grava fora da pasta');
  check(results.includes('programa=ERR_ACCESS_DENIED'), 'pelo sistema: não executa programas');
  check(results.includes('dentro=PERMITIDO'), 'e dentro da pasta funciona normalmente');
  rmSync(probePath, { force: true });

  await shot(gm, 'arquivos');

  section('Abrir para os jogadores (com um Tailscale de mentira)');
  await gm.goto(`${BASE}/mesas`);
  check(await gm.waitText('Mesa fechada'), 'a mesa começa fechada');
  await gm.clickButton('Abrir para os jogadores');
  check(await gm.waitText('Mesa aberta para os jogadores'), 'o botão abre a mesa');
  check(await gm.waitText('mesa-de-teste.tail0000.ts.net'), 'e mostra o endereço público');
  await shot(gm, 'mesas');
  const newInvite = await gm.api('POST', `/tables/${table.id}/invites`);
  check(newInvite.link.startsWith('https://mesa-de-teste.tail0000.ts.net/convite#codigo='), 'o convite usa o endereço público');
  const tunnelled = await gm.eval<number>(`fetch('/api/host/close', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.9' }, body: '{}' }).then((r) => r.status)`);
  check(tunnelled === 403, 'pelo túnel, mesmo com a sessão do dono, não dá para mexer na mesa');
  await gm.clickButton('Fechar a mesa');
  check(await gm.waitText('Mesa fechada'), 'o botão fecha a mesa');
  await gm.api('DELETE', `/tables/${table.id}/invites`);

  section('Worldbuild e bestiário no servidor');
  const put = (item: Record<string, unknown> & { id: string }) => gm.api('PUT', `/worlds/${worldId}/items/${item.id}`, item);
  const stamp = { createdAt: 1, updatedAt: 1 };
  const image = await gm.upload(`worldId=${worldId}`, PNG_BLOB, 'lobo.png');
  check(image.status === 201, 'imagem enviada ao mundo');
  await put({ ...stamp, id: 'pasta-publica', type: 'folder', parentId: null, name: 'Cronicas publicas' });
  await put({ ...stamp, id: 'doc-publico', type: 'document', parentId: 'pasta-publica', name: 'Lenda de Zehenia', content: '<p>texto revelado</p>' });
  await put({ ...stamp, id: 'pasta-secreta', type: 'folder', parentId: null, name: 'Planos do mestre' });
  await put({ ...stamp, id: 'doc-secreto', type: 'document', parentId: 'pasta-secreta', name: 'Traicao final', content: '<p>segredo</p>' });
  await put({ ...stamp, id: 'espada', type: 'item', parentId: 'pasta-secreta', name: 'Espada Antiga', tags: [{ id: 'afiada', text: 'Afiada', color: '#ff0000', level: 2 }] });
  await put({ ...stamp, id: 'elfo', type: 'race', parentId: 'pasta-secreta', name: 'Elfo', traits: ['Visao no escuro'], statusMods: {} });
  const wolfToken = { size: 2, vision: { enabled: false, range: 18 }, bars: [], tags: [], blobId: image.file.id };
  await put({ ...stamp, id: 'lobo', type: 'npc', parentId: 'pasta-secreta', name: 'Lobo Cinzento', token: wolfToken });

  // Mestre arruma a cena pela sala
  await gm.openRoom(table.id);
  await player.openRoom(table.id);
  await gm.command('addScene', { scene: { id: 'cena', name: 'Ponte', gridSize: 70, showGrid: true, tokens: [], walls: [], drawings: [], notes: [], fog: { enabled: false } } });
  await gm.command('addEntry', { entry: { id: 'ref-lobo', kind: 'npc', name: 'Lobo Cinzento', createdAt: 1, worldNpcId: 'lobo' } });
  await gm.command('placeToken', { sceneId: 'cena', placement: { id: 't-lobo', entryId: 'ref-lobo', x: 300, y: 300 } });
  const inventory = [{ id: 'linha-espada', itemId: 'espada', equipped: true }];
  const anaToken = { size: 2, vision: { enabled: false, range: 18 }, bars: [], tags: [] };
  const sheet = {
    race: '', subrace: '', labels: [], relations: [], themes: [], inventory, notes: [], eiros: 10, studies: [{ id: 'esgrima', text: 'Esgrima', sa: 0, sn: 5 }],
  };
  // A jogadora não pode se dar um item secreto nem definir o SN de um estudo: o servidor recusa
  const cheatSheet = await player.command('addEntry', { entry: { id: 'pc-trapaca', kind: 'character', name: 'Trapaça', createdAt: 1, token: anaToken, sheet } });
  check(cheatSheet.t === 'nack', 'jogadora não cria ficha já com SN definido ou item secreto', JSON.stringify(cheatSheet));
  const created = await gm.command('addEntry', { entry: { id: 'pc-ana', kind: 'character', name: 'Ana', createdAt: 1, ownerUserId: playerAccount.user.id, token: anaToken, sheet } });
  check(created.t === 'ack', 'mestre deu à personagem da jogadora um item do mundo', JSON.stringify(created));
  await player.command('placeToken', { sceneId: 'cena', placement: { id: 't-ana', entryId: 'pc-ana', x: 150, y: 150 } });
  await gm.command('toggleLoreReveal', { folderId: 'pasta-publica' });

  // As duas pessoas abrem a mesa de verdade
  await gm.goto(`${BASE}/mesa-online/${table.id}`);
  await player.goto(`${BASE}/mesa-online/${table.id}`);
  check(await gm.waitText('Online'), 'mestre conectado (barra mostra "Online")');
  check(await player.waitText('Online'), 'jogadora conectada');

  await player.clickButton('Lore');
  check(await player.waitText('Cronicas publicas'), 'jogadora vê na Lore a pasta revelada');
  const playerLore = await player.text();
  check(!playerLore.includes('Planos do mestre') && !playerLore.includes('Traicao final'), 'jogadora NÃO vê a pasta secreta nem o que há nela');
  await gm.clickButton('Lore');
  check(await gm.waitText('Planos do mestre'), 'mestre vê o mundo inteiro, vindo do servidor');

  const wolfImage = await until(() => player.eval(`[...document.querySelectorAll('app-tokens-layer img')].some((i) => i.src.startsWith('blob:') && i.naturalWidth > 0)`), 'imagem do token', 6000).then(
    () => true,
    () => false,
  );
  check(wolfImage, 'na outra máquina, o token do NPC do bestiário aparece com a imagem do mundo');

  await player.clickButton('Fichas');
  await sleep(200);
  check(await player.eval(`document.body.innerText.includes('Ana')`), 'jogadora vê o próprio personagem no painel');

  // O mestre revela outra pasta e cria um item: chega sozinho, sem recarregar
  await put({ ...stamp, id: 'doc-novo', type: 'document', parentId: 'pasta-publica', name: 'Capitulo novo', content: '' });
  await player.clickButton('Lore');
  await until(() => player.eval(`[...document.querySelectorAll('button, a, span')].some((e) => e.innerText?.includes('Cronicas publicas'))`), 'pasta');
  await player.eval(`[...document.querySelectorAll('button, a, span, div')].filter((e) => e.children.length === 0 && e.innerText?.trim() === 'Cronicas publicas')[0]?.click()`);
  check(await player.waitText('Capitulo novo', 6000), 'documento criado pelo mestre chega à jogadora em tempo real');

  section('Itens: largar, pegar, comprar');
  await player.goto(`${BASE}/mesa-online/${table.id}`);
  await player.waitText('Online');
  await player.openRoom(table.id);
  // Largar pelo caminho real do app: o mesmo evento de "soltar" que o arraste do inventário dispara
  await player.eval(`(() => {
    const target = document.querySelector('app-map-stage > div') ?? document.querySelector('app-map-stage');
    const data = new DataTransfer();
    data.setData('application/x-dicetag-item', JSON.stringify({ source: 'inventory', sheetId: 'pc-ana', inventoryId: 'linha-espada' }));
    const rect = target.getBoundingClientRect();
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
  })()`);
  await sleep(600);
  await gm.openRoom(table.id);
  const stateOf = (page: Page) => page.eval(`(() => { const w = window.__replies.filter((m) => m.state).at(-1); return w ? w.state : null; })()`);
  await gm.eval(`window.__room.send(JSON.stringify({ t: 'sync' }))`);
  await sleep(300);
  let view = await stateOf(gm);
  const dropped = view.scenes[0].drops ?? [];
  const anaAfterDrop = view.entries.find((e: { id: string }) => e.id === 'pc-ana');
  check(dropped.length === 1 && dropped[0].item.itemId === 'espada', 'jogadora largou o item: ele está no chão', JSON.stringify(dropped));
  check(anaAfterDrop.sheet.inventory.length === 0, 'o item saiu da ficha (nada duplicado, nada perdido)');
  const dropId: string = dropped[0]?.id;
  const pickUp = await player.command('pickUpDrop', { dropId, sheetId: 'pc-ana', newEntryId: 'linha-nova' });
  check(pickUp.t === 'ack', 'jogadora pegou o item de volta', JSON.stringify(pickUp));
  const again = await player.command('pickUpDrop', { dropId, sheetId: 'pc-ana', newEntryId: 'linha-outra' });
  check(again.t === 'nack', 'pegar o mesmo item duas vezes é recusado');
  // Loja: token de NPC com inventário liberado
  const shop = { ...sheet, inventory: [{ id: 'venda', itemId: 'espada', price: 4, quantity: 1 }], studies: [] };
  await gm.command('updatePlacement', { placementId: 't-lobo', patch: { inventoryPublic: true, sheet: shop } });
  const cheat = await player.command('transferItem', { fromId: 'npc:t-lobo', inventoryId: 'venda', toId: 'pc-ana', newEntryId: 'comprada', cost: 0 });
  check(cheat.t === 'ack' && cheat.payload.cost === 4, 'compra: o preço vem da loja, mesmo o cliente dizendo 0', JSON.stringify(cheat));
  const soldOut = await player.command('transferItem', { fromId: 'npc:t-lobo', inventoryId: 'venda', toId: 'pc-ana', newEntryId: 'comprada2' });
  check(soldOut.t === 'nack', 'a última unidade não é vendida duas vezes');

  section('Rolagens no servidor');
  await gm.command('updateEntry', {
    entryId: 'pc-ana',
    patch: { sheet: { ...sheet, inventory: [{ id: 'linha-espada', itemId: 'espada', equipped: true }], eiros: 6, studies: [{ id: 'esgrima', text: 'Esgrima', sa: 0, sn: 5 }] } },
  });
  const roll = await player.roll({ sheetId: 'pc-ana', roll: { dice: '2d12', modifier: 1, attributes: ['item:linha-espada:afiada'], addItems: true }, label: 'Golpe', icon: 'swords', studies: ['esgrima'] });
  check(roll.t === 'ack' && roll.payload.roll.modifier === 3 && roll.payload.roll.itemModifier === 2, 'etiqueta do item do mundo soma ao total (+1 fixo +2 do item)', JSON.stringify(roll));
  await player.clickButton('Chat');
  check(await gm.waitText('Golpe', 4000) || (await gm.clickButton('Chat'), await gm.waitText('Golpe', 4000)), 'o resultado da rolagem aparece no chat do mestre');

  section('Pings e efeitos em tempo real');
  await gm.goto(`${BASE}/mesa-online/${table.id}`);
  await gm.waitText('Online');
  await player.goto(`${BASE}/mesa-online/${table.id}`);
  await player.waitText('Online');
  await gm.eval(`[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Ping')?.click()`);
  await sleep(150);
  await gm.clickAt(700, 450);
  const gotPing = await until(() => player.eval('window.__seen.ping > 0'), 'ping', 3000).then(
    () => true,
    () => false,
  );
  check(gotPing, 'ping do mestre apareceu na tela da jogadora');
  await player.eval(`[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Ping')?.click()`);
  await sleep(150);
  await player.clickAt(600, 400);
  const pingBack = await until(() => gm.eval('window.__seen.ping > 1'), 'ping de volta', 3000).then(
    () => true,
    () => false,
  );
  check(pingBack, 'ping da jogadora apareceu na tela do mestre');
  await gm.eval(`[...document.querySelectorAll('button')].find((b) => /efeitos/i.test(b.getAttribute('aria-label') ?? ''))?.click()`);
  await sleep(150);
  await gm.drag([500, 300], [800, 500]);
  const gotFx = await until(() => player.eval('window.__seen.fx > 0'), 'efeito', 3000).then(
    () => true,
    () => false,
  );
  check(gotFx, 'efeito lançado pelo mestre apareceu na tela da jogadora');
  await gm.press('v');

  section('Sons em tempo real');
  const sound = await gm.upload(`tableId=${table.id}`, SILENT_WAV, 'emboscada.wav');
  check(sound.status === 201, 'som enviado');
  await gm.openRoom(table.id);
  await gm.command('addEntry', { entry: { id: 'trilha', kind: 'sound', name: 'Emboscada na ponte', createdAt: 1, blobId: sound.file.id, volume: 0.5, loop: true } });
  await gm.clickButton('Sons');
  await gm.waitText('Emboscada na ponte');
  const hidden = await player.eval(`document.body.innerText.includes('Emboscada')`);
  check(!hidden, 'a jogadora não vê o nome da faixa');
  await gm.eval(`[...document.querySelectorAll('app-sound-list button')].find((b) => b.querySelector('mat-icon')?.textContent?.trim() === 'play_arrow')?.click()`);
  const blockedOrPlaying = await until(() => player.eval(`window.__audios.length > 0`), 'áudio na jogadora', 5000).then(
    () => true,
    () => false,
  );
  check(blockedOrPlaying, 'a máquina da jogadora começou a carregar a faixa que o mestre tocou');
  await sleep(400);
  // Sem nenhum clique, o navegador pode bloquear o som: o aviso aparece, e o clique libera
  await player.clickAt(700, 450);
  const playing = await until(() => player.eval(`window.__audios.some((a) => !a.paused)`), 'tocando', 5000).then(
    () => true,
    () => false,
  );
  check(playing, 'o som está tocando na máquina da jogadora');
  await sleep(1500);
  // Outro aparelho: a mesma pessoa volta à MESMA conta, pelo link de retorno do mestre
  const lateJoiner = await Page.open(cdp);
  const back = await gm.api('POST', `/tables/${table.id}/members/${playerAccount.user.id}/access-link`);
  await lateJoiner.goto(`${BASE}/convite#codigo=${back.code}`);
  await until(() => lateJoiner.eval(`[...document.querySelectorAll('button')].some((b) => b.innerText?.includes('Entrar na mesa') && !b.disabled) || !!document.querySelector('input[autocomplete="nickname"]')`), 'página de retorno');
  await lateJoiner.clickButton('Entrar na mesa');
  await lateJoiner.waitText('Online');
  check((await lateJoiner.api('GET', '/auth/me')).user?.id === playerAccount.user.id, 'o link de retorno devolve a mesma conta, sem senha');
  await until(() => lateJoiner.eval('window.__audios.length > 0'), 'faixa', 5000).catch(() => undefined);
  await sleep(300);
  await lateJoiner.clickAt(700, 450);
  await sleep(500);
  const position = await lateJoiner.eval<number>(`window.__audios[0]?.currentTime ?? 0`);
  check(position > 1, 'quem chega depois entra no meio da faixa, não do início', `posição ${position}`);
  await gm.eval(`[...document.querySelectorAll('app-sound-list button')].find((b) => b.innerText?.includes('Parar tudo'))?.click()`);
  const stopped = await until(() => player.eval(`window.__audios.every((a) => a.paused || !a.src)`), 'parar', 4000).then(
    () => true,
    () => false,
  );
  check(stopped, '"Parar tudo" do mestre para o som na outra máquina');

  section('Metadados das imagens (EXIF)');
  const jpegPath = join(work, 'foto-com-gps.jpg');
  writeFileSync(jpegPath, jpegWithExif());
  await gm.eval(`document.querySelector('input[type=file][accept="image/*"]') !== null`);
  const { root } = await gm.send('DOM.getDocument');
  const { nodeId } = await gm.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'app-scene-bar input[type=file]' });
  await gm.send('DOM.setFileInputFiles', { nodeId, files: [jpegPath] });
  await sleep(1200);
  await gm.eval(`window.__room.send(JSON.stringify({ t: 'sync' }))`);
  await sleep(300);
  view = await stateOf(gm);
  const blobId: string | undefined = view.scenes.map((s: { blobId?: string }) => s.blobId).find(Boolean);
  check(!!blobId, 'foto enviada pela tela como mapa da cena', JSON.stringify(view.scenes.map((s: { id: string; blobId?: string }) => [s.id, s.blobId])));
  if (blobId) {
    const stored = await gm.eval<{ gps: boolean; orientation: number; jpeg: boolean }>(`fetch('/api/files/${blobId}').then((r) => r.arrayBuffer()).then((b) => {
      const bytes = new Uint8Array(b);
      return { gps: String.fromCharCode(...bytes).includes('GPS-LOCALIZACAO'), orientation: bytes[30], jpeg: bytes[0] === 0xff && bytes[1] === 0xd8 };
    })`);
    check(stored.jpeg && !stored.gps, 'no servidor, o arquivo não tem mais a localização');
    check(stored.orientation === 6, 'a orientação da foto foi preservada');
  }

  section('Biblioteca dentro da mesa');
  await gm.goto(`${BASE}/mesa-online/${table.id}`);
  await gm.waitText('Online');
  const scenesBefore = await gm.eval<number>(`document.querySelectorAll('app-scene-bar button').length`);
  await gm.eval(`[...document.querySelectorAll('app-scene-bar button')].find((b) => b.querySelector('mat-icon')?.textContent?.trim() === 'add')?.click()`);
  await sleep(250);
  check(await gm.clickButton('Cena com mapa da biblioteca'), 'o mestre escolhe o mapa da biblioteca ao criar a cena');
  check(await gm.waitText('Escolher imagem'), 'o seletor abre');
  await gm.waitText('Mapas');
  await gm.eval(`[...document.querySelectorAll('app-library-picker li button')].find((b) => b.innerText.includes('Mapas'))?.click()`);
  await gm.waitText('ponte.png');
  await shot(gm, 'seletor');
  await gm.eval(`[...document.querySelectorAll('app-library-picker li button')].find((b) => b.innerText.includes('ponte.png'))?.click()`);
  const sceneAdded = await gm.waitText('ponte', 8000) && (await until(async () => (await gm.eval<number>(`document.querySelectorAll('app-scene-bar button').length`)) > scenesBefore, 'cena nova', 8000).then(() => true, () => false));
  check(sceneAdded, 'a cena nasce com o mapa escolhido');
  const soundForLibrary = await gm.eval<{ status: number }>(`(async () => {
    const form = new FormData();
    form.append('file', ${SILENT_WAV}, 'chuva.wav');
    const res = await fetch('/api/library/files?folder=sons', { method: 'POST', body: form });
    return { status: res.status };
  })()`);
  check(soundForLibrary.status === 201, 'um som enviado à biblioteca');
  await gm.clickButton('Sons');
  await gm.waitText('Da biblioteca');
  await gm.clickButton('Da biblioteca');
  await gm.waitText('chuva.wav');
  await gm.eval(`[...document.querySelectorAll('app-library-picker li button')].find((b) => b.innerText.includes('chuva.wav'))?.click()`);
  await sleep(150);
  await gm.eval(`[...document.querySelectorAll('app-library-picker button')].find((b) => b.innerText?.trim().startsWith('Usar'))?.click()`);
  const soundListed = await until(() => gm.eval<boolean>(`document.querySelector('app-sound-list')?.innerText.includes('chuva') ?? false`), 'som na lista', 8000).then(() => true, () => false);
  check(soundListed, 'o som da biblioteca entra na lista da mesa');

  section('Senha do dono, só pelo terminal');
  const NEW_PASSWORD = randomBytes(12).toString('base64url');
  const changed = spawnSync(process.execPath, ['--import', 'tsx', '--disable-warning=ExperimentalWarning', 'scripts/dono.ts'], { env: { ...APP_ENV, DONO_SENHA: NEW_PASSWORD }, encoding: 'utf8' });
  check(changed.status === 0, 'npm run dono troca a senha', changed.stderr);
  check((await gm.api('GET', '/auth/me')).status === 401, 'as sessões antigas do dono caem');
  const stranger = await Page.open(cdp);
  await stranger.goto(`${BASE}/entrar`);
  check((await stranger.api('POST', '/auth/login', { email: OWNER_EMAIL, password: PASSWORD })).status === 401, 'a senha antiga não entra mais');
  check((await gm.api('POST', '/auth/login', { email: OWNER_EMAIL, password: NEW_PASSWORD })).status === 200, 'a senha nova entra');
  check((await player.api('GET', '/auth/me')).status === 200, 'a sessão dos convidados não é afetada');

  section('Mundo editado pela tela');
  await gm.goto(`${BASE}/worldbuild?servidor=${worldId}`);
  check(await gm.waitText('Planos do mestre'), 'página Worldbuild abre o mundo do servidor, fora da mesa');
  await gm.clickButton('Nova pasta');
  const saved = await until(async () => {
    const { items } = await gm.api('GET', `/worlds/${worldId}/items`);
    return items.some((i: { name: string }) => i.name === 'Nova pasta');
  }, 'pasta gravada', 5000).then(
    () => true,
    () => false,
  );
  check(saved, 'o que o mestre cria na tela é gravado no servidor');
  await gm.goto(`${BASE}/worldbuild?servidor=${worldId}`);
  // A tela tem também o botão "Nova pasta": o item é a segunda ocorrência
  const listed = await until(async () => (await gm.text()).split('Nova pasta').length > 2, 'pasta na lista', 6000).then(
    () => true,
    () => false,
  );
  check(listed, 'e continua lá depois de recarregar');

  section('Mundo deste navegador enviado ao servidor');
  await gm.goto(`${BASE}/worldbuild`);
  await gm.waitText('Meu mundo');
  const worldLocal = await gm.text();
  check(!worldLocal.includes('Planos do mestre'), 'sem o parâmetro, a página volta ao mundo deste navegador');
  await gm.clickButton('Nova pasta');
  await sleep(700);
  await gm.goto(`${BASE}/mesas`);
  await gm.waitText('Mesa E2E');
  await gm.eval('window.confirm = () => true');
  await gm.clickButton('Opções da mesa online');
  await sleep(250);
  await gm.clickButton('deste navegador');
  const imported = await until(async () => {
    const { items } = await gm.api('GET', `/worlds/${worldId}/items`);
    return items.filter((i: { name: string }) => i.name === 'Nova pasta').length === 2;
  }, 'mundo enviado', 8000).then(
    () => true,
    () => false,
  );
  check(imported, 'o mundo local foi copiado para o mundo da mesa');
  const localKept = await gm.eval<boolean>(`new Promise((resolve) => {
    const open = indexedDB.open('dicetag');
    open.onsuccess = () => {
      const read = open.result.transaction('kv').objectStore('kv').get('worldbuild:guest');
      read.onsuccess = () => resolve((read.result ?? []).length === 1);
    };
  })`);
  check(localKept, 'e continua intacto neste navegador');

  section('Servidor reiniciando no meio da partida');
  await gm.goto(`${BASE}/mesa-online/${table.id}`);
  check(await gm.waitText('Online'), 'mestre na mesa');
  await gm.openRoom(table.id);
  await gm.command('moveToken', { placementId: 't-lobo', x: 777, y: 333 });
  await sleep(700);
  const old = server;
  old?.kill();
  await until(() => old?.exitCode !== null || old?.killed === true, 'servidor parado');
  check(await gm.waitText('Reconectando', 6000) || await gm.waitText('Desconectado', 1000), 'a barra mostra que a conexão caiu');
  await sleep(1500);
  // O servidor cai junto com o processo principal: nada fica aberto sozinho
  await until(async () => !(await fetch(`${BASE}/api/health`).catch(() => null)), 'servidor fora do ar', 8000);
  check(true, 'o servidor caiu junto com o processo principal');
  await startServer();
  check(await gm.waitText('Online', 35_000), 'o app volta sozinho quando o servidor volta');
  await gm.openRoom(table.id);
  const restored = await gm.eval(`window.__replies.find((m) => m.t === 'welcome').state.scenes[0].tokens.find((t) => t.id === 't-lobo')`);
  check(restored?.x === 777, 'nada se perdeu: o estado volta do banco', JSON.stringify(restored));

  section('Segurança no caminho real');
  const csp = await fetch(`${BASE}/mesas`).then((r) => r.headers.get('content-security-policy') ?? '');
  check(csp.includes("script-src 'self'") && !csp.includes("script-src 'self' 'unsafe-inline'"), 'a CSP só aceita scripts do próprio servidor');
  await shot(gm, 'mestre');
}

main()
  .catch((err: unknown) => {
    failures++;
    console.error(`\nErro: ${err instanceof Error ? err.message : String(err)}`);
  })
  .finally(() => {
    server?.kill();
    setTimeout(() => {
      try {
        rmSync(work, { recursive: true, force: true });
      } catch {
        // O Chrome ainda pode estar soltando os arquivos: a pasta temporária fica para o sistema limpar
      }
      console.log(failures ? `\n${failures} verificação(ões) falharam.` : '\nTudo certo.');
      process.exit(failures ? 1 : 0);
    }, 800);
  });
