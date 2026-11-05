import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { ServerAccountService } from './server-account.service';
import { ServerApiService } from './server-api.service';

/** Mundo do servidor, como a barra lateral e o Worldbuild precisam dele. */
export interface ServerWorldRef {
  id: string;
  name: string;
}

/** Preferência deste navegador: o último mundo do servidor aberto. Só um id, sem dados do mundo. */
const LAST_WORLD_KEY = 'dicetag.serverWorld';

/**
 * Lista dos mundos do servidor, para o dono do app chegar a eles pela barra lateral.
 * Quem grava e lê os itens de cada mundo continua sendo o `WorldbuildService`.
 */
@Injectable({ providedIn: 'root' })
export class ServerWorldsService {
  private readonly api = inject(ServerApiService);
  private readonly account = inject(ServerAccountService);

  readonly worlds = signal<ServerWorldRef[]>([]);
  private pending: Promise<void> | null = null;

  constructor() {
    // Só o dono tem mundos: a lista segue a conta (entrou, saiu, trocou)
    effect(() => {
      const owner = this.account.isOwner();
      untracked(() => {
        if (owner) void this.load();
        else {
          this.pending = null;
          this.worlds.set([]);
        }
      });
    });
  }

  /** Busca a lista de novo (depois de importar uma cópia, por exemplo). Se falhar, fica a que já havia. */
  load(): Promise<void> {
    this.pending = this.api
      .get<{ worlds: ServerWorldRef[] }>('/worlds')
      .then(({ worlds }) => this.worlds.set(worlds))
      .catch(() => undefined);
    return this.pending;
  }

  /** Espera a lista estar pronta, sem buscar de novo se já há uma busca feita. */
  ensure(): Promise<void> {
    return this.pending ?? this.load();
  }

  /** O mundo a abrir quando nenhum foi pedido: o último usado ou o primeiro. */
  preferred(): string | null {
    const list = this.worlds();
    const last = readLastWorld();
    return list.find((w) => w.id === last)?.id ?? list[0]?.id ?? null;
  }

  remember(id: string): void {
    try {
      localStorage.setItem(LAST_WORLD_KEY, id);
    } catch {
      // Sem armazenamento (janela privada): só não lembra da próxima vez
    }
  }
}

function readLastWorld(): string | null {
  try {
    return localStorage.getItem(LAST_WORLD_KEY);
  } catch {
    return null;
  }
}
