import { Injectable, inject, signal } from '@angular/core';
import { ServerApiService, ServerError } from './server-api.service';

/** As duas pastas fixas da biblioteca. */
export type LibrarySection = 'imagens' | 'sons';

/** Item da biblioteca (pasta ou arquivo). `path` é o id, relativo à pasta: `imagens/mapas/ponte.png`. */
export interface LibraryEntry {
  path: string;
  name: string;
  type: 'folder' | 'file';
  section: LibrarySection;
  size: number;
  modifiedAt: number;
}

/** Resposta de `GET /library`. */
interface LibraryListing {
  root: string;
  maxUploadMb: number;
  sandboxed: boolean;
  entries: LibraryEntry[];
  ignored: number;
  truncated: boolean;
}

/** Quantos envios ao mesmo tempo. */
const UPLOAD_CONCURRENCY = 3;

/** Seção certa para um arquivo, pelo tipo. null = não é imagem nem áudio. */
export function sectionOf(file: { type: string; name: string }): LibrarySection | null {
  if (file.type.startsWith('image/')) return 'imagens';
  if (file.type.startsWith('audio/') || /\.(mp3|ogg|oga|opus|wav|flac|m4a|m4b|aac|weba)$/i.test(file.name)) return 'sons';
  return null;
}

/** Pasta de um caminho (`imagens/a/b.png` → `imagens/a`). */
export function parentOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/'));
}

/**
 * Biblioteca de arquivos do dono do app: uma pasta real do computador dele, com `imagens/` e `sons/`.
 * Só o dono acessa, e o servidor confere cada caminho: esta classe só faz as chamadas e guarda a
 * lista para as telas (a aba Arquivos e o seletor dentro da mesa).
 */
@Injectable({ providedIn: 'root' })
export class LibraryService {
  private readonly api = inject(ServerApiService);

  readonly entries = signal<LibraryEntry[]>([]);
  /** Caminho da pasta no computador. */
  readonly root = signal('');
  /** O servidor está preso a esta pasta também pelo sistema (rodando por `npm run mesa`). */
  readonly sandboxed = signal(false);
  /** Arquivos de outros tipos na pasta, que o app não usa. */
  readonly ignored = signal(0);
  readonly loaded = signal(false);
  readonly maxUploadMb = signal(0);
  /** Andamento dos envios (null = nada em andamento). */
  readonly progress = signal<{ done: number; total: number } | null>(null);

  async load(): Promise<void> {
    const listing = await this.api.get<LibraryListing>('/library');
    this.entries.set(listing.entries);
    this.root.set(listing.root);
    this.sandboxed.set(listing.sandboxed);
    this.ignored.set(listing.ignored);
    this.maxUploadMb.set(listing.maxUploadMb);
    this.loaded.set(true);
  }

  /** Endereço do arquivo, para mostrar ou tocar. */
  fileUrl(path: string): string {
    return `/api/library/file?path=${encodeURIComponent(path)}`;
  }

  /** O arquivo em si, para usar na mesa: quem o envia à mesa tira os metadados no caminho. */
  async fetchFile(entry: LibraryEntry): Promise<File> {
    const blob = await this.api.getBlob(`/library/file?path=${encodeURIComponent(entry.path)}`);
    if (!blob) throw new ServerError(404, `Não foi possível ler "${entry.name}".`);
    return new File([blob], entry.name, { type: blob.type });
  }

  async createFolder(path: string): Promise<void> {
    await this.api.post('/library/folders', { path });
    await this.load();
  }

  async move(from: string, to: string): Promise<void> {
    await this.api.post('/library/move', { from, to });
    await this.load();
  }

  async remove(path: string): Promise<void> {
    await this.api.post('/library/delete', { path });
    await this.load();
  }

  /**
   * Envia vários arquivos, cada um para a pasta indicada. Devolve os nomes recusados, com o motivo:
   * um arquivo recusado não interrompe os demais.
   */
  async upload(jobs: readonly { file: File; folder: string }[]): Promise<{ name: string; reason: string }[]> {
    const failed: { name: string; reason: string }[] = [];
    const queue = [...jobs];
    let done = 0;
    this.progress.set({ done, total: jobs.length });
    const worker = async (): Promise<void> => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        try {
          await this.api.upload(`/library/files?folder=${encodeURIComponent(job.folder)}`, job.file, job.file.name);
        } catch (e) {
          failed.push({ name: job.file.name, reason: e instanceof Error ? e.message : 'erro desconhecido.' });
        }
        this.progress.set({ done: ++done, total: jobs.length });
      }
    };
    try {
      await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, worker));
    } finally {
      this.progress.set(null);
      await this.load();
    }
    return failed;
  }
}
