import { randomUUID } from 'node:crypto';
import type { HostStatus } from '../ops/tailscale';

/**
 * Controle da mesa (abrir para os jogadores, abrir a pasta) a partir do app.
 *
 * O servidor exposto à internet NÃO executa programas: o modelo de permissões do Node o proíbe em
 * `npm run mesa`. Ele só pede, por um canal interno, ao processo que o iniciou (`scripts/mesa.ts`),
 * e esse canal só tem estes pedidos fixos: não há como passar um comando ou um caminho por ele.
 */
export interface HostControl {
  status(): Promise<HostStatus>;
  open(): Promise<HostStatus>;
  close(): Promise<HostStatus>;
  openFolder(): Promise<void>;
}

export type HostOperation = 'status' | 'open' | 'close' | 'open-folder';

/** Pedido do servidor ao processo que o iniciou. */
export interface HostRequest {
  hostId: string;
  operation: HostOperation;
}

/** Resposta ao pedido `hostId`. */
export interface HostReply {
  hostId: string;
  status: HostStatus;
}

const UNAVAILABLE: HostStatus = { state: 'unavailable', message: 'Inicie o app com "Iniciar mesa" (npm run mesa) para abrir a mesa aos jogadores.' };
/** A aprovação do Funnel e a conexão podem demorar. */
const REPLY_TIMEOUT_MS = 30_000;

/** Sem `npm run mesa` (desenvolvimento, testes): não há quem controle o túnel. */
export const NO_HOST_CONTROL: HostControl = {
  status: async () => UNAVAILABLE,
  open: async () => UNAVAILABLE,
  close: async () => UNAVAILABLE,
  openFolder: async () => undefined,
};

/** Pede ao processo pai, pelo canal IPC que ele abriu ao iniciar este servidor. */
export function ipcHostControl(send: NonNullable<typeof process.send>): HostControl {
  const pending = new Map<string, (status: HostStatus) => void>();
  process.on('message', (message: unknown) => {
    const reply = message as Partial<HostReply> | null;
    if (typeof reply?.hostId !== 'string' || !reply.status) return;
    pending.get(reply.hostId)?.(reply.status);
    pending.delete(reply.hostId);
  });
  const ask = (operation: HostOperation) =>
    new Promise<HostStatus>((resolve) => {
      const hostId = randomUUID();
      const timer = setTimeout(() => {
        pending.delete(hostId);
        resolve({ state: 'error', message: 'O processo da mesa não respondeu.' });
      }, REPLY_TIMEOUT_MS);
      timer.unref();
      pending.set(hostId, (status) => {
        clearTimeout(timer);
        resolve(status);
      });
      send({ hostId, operation } satisfies HostRequest);
    });
  return {
    status: () => ask('status'),
    open: () => ask('open'),
    close: () => ask('close'),
    openFolder: async () => {
      await ask('open-folder');
    },
  };
}
