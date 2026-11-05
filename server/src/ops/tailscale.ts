/**
 * Leitura do que o programa `tailscale` responde (funções puras, testadas sem ele instalado).
 * Quem executa o programa é `scripts/lib/funnel.ts`, fora do processo exposto à internet.
 */

/** Situação da mesa para o app mostrar. */
export type HostState =
  /** Rodando sem `npm run mesa`: não há quem controle o túnel. */
  | 'unavailable'
  | 'not-installed'
  | 'logged-out'
  | 'closed'
  /** A conta do Tailscale precisa aprovar o Funnel uma vez, na página `approvalUrl`. */
  | 'approval'
  | 'open'
  | 'error';

export interface HostStatus {
  state: HostState;
  /** Endereço público (`https://….ts.net`), mesmo com a mesa fechada, se o Tailscale já o conhece. */
  url?: string;
  approvalUrl?: string;
  message?: string;
}

/** Só endereços do Tailscale: a resposta do programa nunca vira uma origem autorizada qualquer. */
const TS_NET_NAME = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net$/i;
const APPROVAL_URL = /https:\/\/login\.tailscale\.com\/\S+/;

/** O que interessa de `tailscale status --json`. */
export function parseTailscaleStatus(json: string): { loggedIn: boolean; url?: string; loginUrl?: string } {
  let data: { BackendState?: unknown; AuthURL?: unknown; Self?: { DNSName?: unknown } };
  try {
    data = JSON.parse(json) as typeof data;
  } catch {
    return { loggedIn: false };
  }
  const name = typeof data.Self?.DNSName === 'string' ? data.Self.DNSName.replace(/\.$/, '') : '';
  const loginUrl = typeof data.AuthURL === 'string' && data.AuthURL.startsWith('https://') ? data.AuthURL : undefined;
  return {
    loggedIn: data.BackendState === 'Running',
    ...(TS_NET_NAME.test(name) && { url: `https://${name}` }),
    ...(loginUrl && { loginUrl }),
  };
}

/** O que a saída de `tailscale funnel <porta>` diz até agora. */
export function parseFunnelOutput(output: string): { ready: boolean; approvalUrl?: string } {
  const approvalUrl = APPROVAL_URL.exec(output)?.[0];
  return { ready: /available on the internet/i.test(output), ...(approvalUrl && { approvalUrl }) };
}
