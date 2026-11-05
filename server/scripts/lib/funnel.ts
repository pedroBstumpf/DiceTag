import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { parseFunnelOutput, parseTailscaleStatus, type HostStatus } from '../../src/ops/tailscale';

/** Tempo esperando o túnel responder antes de devolver a situação à tela. */
const OPEN_TIMEOUT_MS = 20_000;

/** Como chamar o programa: o instalado ou, nos testes, o de TAILSCALE_ARGV (JSON com os argumentos). */
function command(): string[] | null {
  const custom = process.env['TAILSCALE_ARGV'];
  if (custom) return JSON.parse(custom) as string[];
  const windows = 'C:\\Program Files\\Tailscale\\tailscale.exe';
  if (process.platform === 'win32' && existsSync(windows)) return [windows];
  const inPath = (process.env['PATH'] ?? '').split(process.platform === 'win32' ? ';' : ':').some((dir) => existsSync(`${dir}/tailscale${process.platform === 'win32' ? '.exe' : ''}`));
  return inPath ? ['tailscale'] : null;
}

/**
 * Executa um comando fixo do Tailscale e devolve a saída. Sem shell: nada vira comando, e nenhum
 * argumento vem do navegador (a porta é a do próprio servidor).
 */
function run(argv: string[], args: string[]): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(argv[0], [...argv.slice(1), ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    child.stdout.on('data', (d: Buffer) => (output += d.toString()));
    child.stderr.on('data', (d: Buffer) => (output += d.toString()));
    child.on('error', () => resolve({ code: -1, output }));
    child.on('close', (code) => resolve({ code, output }));
  });
}

/**
 * O túnel do Tailscale Funnel, em primeiro plano de propósito: ele vive como processo filho e morre
 * com a mesa. Fechou a janela ou apertou Ctrl+C, a mesa sai da internet. Nada fica aberto depois.
 */
export class Funnel {
  private child: ChildProcess | null = null;
  private output = '';

  constructor(private readonly port: number) {}

  /** Endereço público, se o Tailscale estiver instalado e com a conta conectada. */
  async publicUrl(): Promise<string | undefined> {
    const argv = command();
    if (!argv) return undefined;
    return parseTailscaleStatus((await run(argv, ['status', '--json'])).output).url;
  }

  async status(): Promise<HostStatus> {
    const argv = command();
    if (!argv) return { state: 'not-installed' };
    const { output } = await run(argv, ['status', '--json']);
    const info = parseTailscaleStatus(output);
    if (!info.loggedIn) return { state: 'logged-out', ...(info.loginUrl && { approvalUrl: info.loginUrl }) };
    const url = info.url;
    if (!this.child) return { state: 'closed', ...(url && { url }) };
    const tunnel = parseFunnelOutput(this.output);
    if (tunnel.ready) return { state: 'open', ...(url && { url }) };
    if (tunnel.approvalUrl) return { state: 'approval', approvalUrl: tunnel.approvalUrl, ...(url && { url }) };
    return { state: 'closed', message: 'Conectando…', ...(url && { url }) };
  }

  async open(): Promise<HostStatus> {
    const argv = command();
    if (!argv) return { state: 'not-installed' };
    const before = await this.status();
    if (before.state === 'logged-out' || this.child) return before;
    this.output = '';
    const child = spawn(argv[0], [...argv.slice(1), 'funnel', `localhost:${this.port}`], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    this.child = child;
    const collect = (d: Buffer) => (this.output += d.toString());
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const ended = new Promise<void>((resolve) => {
      child.on('error', () => resolve());
      child.on('close', () => {
        if (this.child === child) this.child = null;
        resolve();
      });
    });
    // Até o túnel subir, pedir a aprovação da conta ou o programa terminar com erro
    const end = Date.now() + OPEN_TIMEOUT_MS;
    let finished = false;
    void ended.then(() => (finished = true));
    while (Date.now() < end && !finished) {
      const now = parseFunnelOutput(this.output);
      if (now.ready || now.approvalUrl) return this.status();
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (finished) return { state: 'error', message: this.output.trim().slice(0, 500) || 'O Tailscale não conseguiu abrir a mesa.' };
    return this.status();
  }

  async close(): Promise<HostStatus> {
    this.stop();
    return this.status();
  }

  /** Encerra o túnel (ao fechar a mesa e ao sair do programa). */
  stop(): void {
    this.child?.kill();
    this.child = null;
    this.output = '';
  }
}
