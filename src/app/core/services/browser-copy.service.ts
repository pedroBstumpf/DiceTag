import { Injectable, inject, signal } from '@angular/core';
import { TABLE_ACCENTS } from '../models/game-table.model';
import { BrowserCopy, COPY_EXTENSION, CopyContents, CopyTable, CopyWorld, buildCopy, isCopyKey, stateBlobIds, stateForServer } from '../utils/browser-copy';
import { LocalFileStore } from './file-store';
import { ServerApiService } from './server-api.service';
import { ServerFileStore } from './server-file-store';
import { StorageService } from './storage.service';
import { WorldImportService } from './world-import.service';

/** Mundo do servidor e se já há itens nele. */
export interface ServerWorld {
  id: string;
  name: string;
  items: number;
}

/** O que foi escolhido na tela: chaves dos mundos e ids das mesas. */
export interface CopyPicks {
  worlds: ReadonlySet<string>;
  tables: ReadonlySet<string>;
}

export interface CopyImportResult {
  worlds: number;
  tables: number;
  items: number;
  files: number;
  failedItems: number;
  failedFiles: number;
  /** O que não pôde ser trazido, com o motivo, para mostrar na tela. */
  problems: string[];
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'erro desconhecido');

/**
 * Salva numa cópia o que está no navegador e traz uma cópia para o servidor.
 *
 * Só lê o navegador e só acrescenta ao servidor: mundos e mesas de origem continuam como estavam,
 * e uma mesa que falha no meio é removida do servidor, para o dono poder tentar de novo.
 * Os ids dos itens do mundo são mantidos: é por eles que a mesa acha NPCs, itens e pastas reveladas.
 */
@Injectable({ providedIn: 'root' })
export class BrowserCopyService {
  private readonly api = inject(ServerApiService);
  private readonly storage = inject(StorageService);
  private readonly localFiles = inject(LocalFileStore);
  private readonly worldImport = inject(WorldImportService);

  /** Andamento, para a tela. Vazio = nada em andamento. */
  readonly progress = this.worldImport.progress;
  readonly saving = signal(false);

  /** Toda chamada daqui espera e tenta de novo se o servidor pedir uma pausa: uma importação grande passa do limite por minuto. */
  private readonly patiently = <T>(call: () => Promise<T>): Promise<T> => this.worldImport.retry(call);

  // --- Salvar ----------------------------------------------------------------------------------

  /** Monta a cópia de tudo o que este navegador guarda e baixa como arquivo. */
  async save(): Promise<void> {
    this.saving.set(true);
    try {
      const keys = await this.storage.keys();
      const data: Record<string, unknown> = {};
      const files: { id: string; blob: Blob }[] = [];
      for (const key of keys) {
        if (isCopyKey(key)) {
          data[key] = await this.storage.get(key);
        } else if (key.startsWith('blob:')) {
          const blob = await this.storage.get<Blob>(key);
          if (blob) files.push({ id: key.slice('blob:'.length), blob });
        }
      }
      const url = URL.createObjectURL(buildCopy(data, files, Date.now()));
      const link = document.createElement('a');
      link.href = url;
      link.download = `zehenia-navegador-${new Date().toISOString().slice(0, 10)}${COPY_EXTENSION}`;
      link.click();
      // Tempo de o navegador começar o download
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } finally {
      this.saving.set(false);
    }
  }

  // --- Trazer para o servidor --------------------------------------------------------------------

  /** Mundos do servidor, com a quantidade de itens: quem já tem conteúdo não é sobrescrito sem aviso. */
  async serverWorlds(): Promise<ServerWorld[]> {
    const { worlds } = await this.patiently(() => this.api.get<{ worlds: { id: string; name: string }[] }>('/worlds'));
    return Promise.all(
      worlds.map(async ({ id, name }) => {
        const { items } = await this.patiently(() => this.api.get<{ items: unknown[] }>(`/worlds/${encodeURIComponent(id)}/items`));
        return { id, name, items: items.length };
      }),
    );
  }

  /** Recarrega uma lista com a mesma paciência. */
  load(call: () => Promise<void>): Promise<void> {
    return this.patiently(call);
  }

  async importCopy(copy: BrowserCopy, contents: CopyContents, picks: CopyPicks, ownerId: string): Promise<CopyImportResult> {
    const result: CopyImportResult = { worlds: 0, tables: 0, items: 0, files: 0, failedItems: 0, failedFiles: 0, problems: [] };
    const known = await this.serverWorlds();
    /** Chave do mundo na cópia → mundo no servidor. */
    const targets = new Map<string, string>();
    /** Imagens já enviadas com o mundo: a mesa reaproveita, sem enviar de novo. */
    const worldFiles = new Map<string, string>();

    const chosen = contents.tables.filter((t) => picks.tables.has(t.table.id));
    const needed = new Set(chosen.map((t) => t.worldKey));
    try {
      for (const world of contents.worlds) {
        if (!picks.worlds.has(world.key) && !needed.has(world.key)) continue;
        try {
          const target = await this.targetOf(world, known, targets);
          // Mesa escolhida num mundo que ainda não está no servidor: o mundo vai junto
          const existed = target.items > 0;
          if (picks.worlds.has(world.key) || !existed) {
            const sent = await this.worldImport.send(world.items, (id) => Promise.resolve(copy.file(id)), target.id);
            result.items += sent.items;
            result.files += sent.files;
            result.failedItems += sent.failedItems;
            result.failedFiles += sent.failedFiles;
            sent.newIds.forEach((next, old) => worldFiles.set(old, next));
            target.items += sent.items;
            result.worlds++;
          }
        } catch (error) {
          result.problems.push(`Mundo "${world.name}": ${messageOf(error)}`);
        }
      }
      for (const table of chosen) {
        const worldId = targets.get(table.worldKey);
        if (!worldId) {
          result.problems.push(`Mesa "${table.table.name}": o mundo dela não pôde ser criado.`);
          continue;
        }
        try {
          await this.sendTable(table, worldId, copy, worldFiles, ownerId, result);
          result.tables++;
        } catch (error) {
          result.problems.push(`Mesa "${table.table.name}": ${messageOf(error)}`);
        }
      }
      return result;
    } finally {
      this.progress.set('');
    }
  }

  /** Mundo de destino: o de mesmo nome; senão, um vazio (ganha o nome); senão, um novo. */
  private async targetOf(world: CopyWorld, known: ServerWorld[], targets: Map<string, string>): Promise<ServerWorld> {
    const taken = new Set(targets.values());
    const free = known.filter((w) => !taken.has(w.id));
    let target = free.find((w) => w.name === world.name);
    if (!target) {
      target = free.find((w) => w.items === 0);
      if (target) {
        const id = target.id;
        await this.patiently(() => this.api.patch(`/worlds/${encodeURIComponent(id)}`, { name: world.name }));
        target.name = world.name;
      }
    }
    if (!target) {
      const created = await this.patiently(() => this.api.post<{ world: { id: string; name: string } }>('/worlds', { name: world.name }));
      target = { id: created.world.id, name: created.world.name, items: 0 };
      known.push(target);
    }
    targets.set(world.key, target.id);
    return target;
  }

  /** Cria a mesa, envia os arquivos dela e grava o estado. Se algo falhar, a mesa não fica pela metade. */
  private async sendTable(
    { table, state }: CopyTable,
    worldId: string,
    copy: BrowserCopy,
    worldFiles: ReadonlyMap<string, string>,
    ownerId: string,
    result: CopyImportResult,
  ): Promise<void> {
    const accents: readonly string[] = TABLE_ACCENTS;
    const { table: created } = await this.patiently(() =>
      this.api.post<{ table: { id: string } }>('/tables', {
        name: table.name.slice(0, 60),
        system: (table.system ?? '').slice(0, 60),
        description: (table.description ?? '').slice(0, 400),
        maxPlayers: Math.min(20, Math.max(1, table.maxPlayers || 1)),
        accent: accents.includes(table.accent) ? table.accent : TABLE_ACCENTS[0],
        worldId,
      }),
    );
    const path = `/tables/${encodeURIComponent(created.id)}`;
    if (state === undefined) return;
    try {
      const files = new ServerFileStore(this.api, { tableId: created.id });
      const ids = stateBlobIds(state);
      const newIds = new Map<string, string>();
      for (const [i, id] of ids.entries()) {
        this.progress.set(`"${table.name}": arquivos ${i + 1} de ${ids.length}`);
        const reused = worldFiles.get(id);
        const blob = reused ? undefined : copy.file(id);
        const saved = reused ?? (blob && (await this.patiently(() => files.put(blob)).catch(() => null)));
        if (saved) {
          newIds.set(id, saved);
          if (!reused) result.files++;
        } else {
          result.failedFiles++;
        }
      }
      this.progress.set(`"${table.name}": gravando a mesa`);
      await this.patiently(() => this.api.put(`${path}/state`, { state: stateForServer(state, newIds, ownerId) }));
    } catch (error) {
      await this.api.delete(path).catch(() => undefined);
      throw error;
    }
  }
}
