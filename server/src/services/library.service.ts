import { randomUUID } from 'node:crypto';
import { createReadStream, mkdirSync, rmSync } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { HttpError, badRequest, conflict, notFound } from '../lib/errors';
import { receiveUpload } from '../lib/upload';
import { FILE_HEAD_BYTES, declaredTypeMatches, detectFileType, type AllowedMime } from '../security/file-type';
import {
  LIBRARY_SECTIONS,
  assertInsideOnDisk,
  extensionAllowed,
  freeName,
  mimeMatchesSection,
  parseLibraryPath,
  safeFileName,
  type LibraryPath,
  type LibrarySection,
} from '../security/library-path';

/** Item da biblioteca, como o dono vê na tela. */
export interface LibraryEntry {
  /** Caminho relativo à biblioteca, com `/`: é o id do item. */
  path: string;
  name: string;
  type: 'folder' | 'file';
  section: LibrarySection;
  size: number;
  modifiedAt: number;
}

/** Pasta dos envios em andamento (começa com ponto: nunca aparece na lista nem é endereçável). */
const TEMP_DIR = '.enviando';
/** Limites da varredura: uma pasta enorme não pode travar o servidor. */
const MAX_ENTRIES = 20_000;
const MAX_DEPTH = 12;

/**
 * Biblioteca de arquivos do dono: uma pasta real do computador, com `imagens/` e `sons/`, onde ele
 * organiza pastas e arquivos pelo app ou direto pelo Explorador do Windows. A lista vem sempre do
 * disco. Só o dono acessa (a rota confere); os jogadores nunca recebem estes arquivos: usar um deles
 * na mesa envia uma cópia para a mesa, sem metadados, e só essa cópia chega aos outros.
 *
 * Todo caminho passa por `security/library-path.ts`, e atalhos (links simbólicos, junções) não são
 * seguidos: nada fora da pasta é lido, listado, alterado ou apagado.
 */
export class LibraryService {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
    for (const section of LIBRARY_SECTIONS) mkdirSync(join(this.root, section), { recursive: true });
    // Envios interrompidos por uma queda do servidor não servem para nada
    rmSync(join(this.root, TEMP_DIR), { recursive: true, force: true });
    mkdirSync(join(this.root, TEMP_DIR), { recursive: true });
  }

  /** Tudo o que o app enxerga na pasta; `ignored`: arquivos de outros tipos, que ficam de fora. */
  async list(): Promise<{ entries: LibraryEntry[]; ignored: number; truncated: boolean }> {
    const entries: LibraryEntry[] = [];
    let ignored = 0;
    let truncated = false;
    const walk = async (dir: string, relative: string, section: LibrarySection, depth: number): Promise<void> => {
      for (const item of await readdir(dir, { withFileTypes: true })) {
        if (entries.length >= MAX_ENTRIES) {
          truncated = true;
          return;
        }
        const path = `${relative}/${item.name}`;
        // Atalhos nunca são seguidos, e o que não é um nome seguro não é endereçável pelo app
        if (item.isSymbolicLink() || !isListable(this.root, path)) {
          ignored++;
          continue;
        }
        const absolute = join(dir, item.name);
        if (item.isDirectory()) {
          const info = await lstat(absolute);
          entries.push({ path, name: item.name, type: 'folder', section, size: 0, modifiedAt: Math.round(info.mtimeMs) });
          if (depth < MAX_DEPTH) await walk(absolute, path, section, depth + 1);
        } else if (item.isFile() && extensionAllowed(section, item.name)) {
          const info = await lstat(absolute);
          entries.push({ path, name: item.name, type: 'file', section, size: info.size, modifiedAt: Math.round(info.mtimeMs) });
        } else {
          ignored++;
        }
      }
    };
    for (const section of LIBRARY_SECTIONS) await walk(join(this.root, section), section, section, 1);
    return { entries, ignored, truncated };
  }

  /** Cria uma pasta (e as de cima, se faltarem). */
  async createFolder(input: unknown): Promise<LibraryEntry> {
    const target = await this.resolve(input);
    if (target.relative === target.section) throw badRequest('Essa pasta já existe.');
    if (await lstat(target.absolute).catch(() => null)) throw conflict('Já existe um item com esse nome.');
    await mkdir(target.absolute, { recursive: true });
    return { path: target.relative, name: basename(target.absolute), type: 'folder', section: target.section, size: 0, modifiedAt: Date.now() };
  }

  /**
   * Recebe um arquivo em streaming, confere o tipo pelos bytes, pela extensão e pelo tipo declarado
   * e só então o coloca na pasta, sem sobrescrever nada (`ponte (2).png`). Só as pastas de cada tipo
   * aceitam o tipo delas: imagem em `imagens/`, som em `sons/`.
   */
  async receive(folderInput: unknown, source: Readable & { truncated?: boolean }, filename: string, declaredMime: string, maxBytes: number): Promise<LibraryEntry> {
    const folder = await this.resolve(folderInput);
    const info = await lstat(folder.absolute).catch(() => null);
    if (!info?.isDirectory()) throw notFound('Pasta não encontrada.');
    const name = safeFileName(filename);
    if (!extensionAllowed(folder.section, name)) throw new HttpError(415, folder.section === 'imagens' ? 'Esta pasta só aceita imagens (PNG, JPEG, GIF, WebP).' : 'Esta pasta só aceita áudio (MP3, OGG, WAV, FLAC, M4A, WebM).');
    const temp = join(this.root, TEMP_DIR, randomUUID());
    try {
      const received = await receiveUpload(source, temp, maxBytes, `Arquivo maior que ${Math.round(maxBytes / (1024 * 1024))} MB.`);
      if (source.truncated) throw new HttpError(413, `Arquivo maior que ${Math.round(maxBytes / (1024 * 1024))} MB.`);
      if (!mimeMatchesSection(folder.section, received.mime) || !declaredTypeMatches(name, declaredMime, received.mime)) {
        throw new HttpError(415, 'O nome ou o tipo do arquivo não corresponde ao conteúdo.');
      }
      const finalName = await freeName(name, async (candidate) => !!(await lstat(join(folder.absolute, candidate)).catch(() => null)));
      const path = `${folder.relative}/${finalName}`;
      const target = parseLibraryPath(this.root, path);
      await rename(temp, target.absolute);
      return { path, name: finalName, type: 'file', section: folder.section, size: received.size, modifiedAt: Date.now() };
    } finally {
      await rm(temp, { force: true });
    }
  }

  /** Abre um arquivo para enviar ao navegador, com o tipo REAL, lido dos bytes dele. */
  async read(input: unknown): Promise<{ stream: Readable; mime: AllowedMime; size: number }> {
    const target = await this.resolve(input);
    const info = await lstat(target.absolute).catch(() => null);
    if (!info?.isFile() || !extensionAllowed(target.section, target.absolute)) throw notFound('Arquivo não encontrado.');
    const handle = await open(target.absolute, 'r');
    let mime: AllowedMime | null;
    try {
      const head = Buffer.alloc(FILE_HEAD_BYTES);
      const { bytesRead } = await handle.read(head, 0, FILE_HEAD_BYTES, 0);
      mime = detectFileType(head.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
    // Colocado à mão com a extensão errada (ex.: uma página renomeada para .png): não é entregue
    if (!mime || !mimeMatchesSection(target.section, mime)) throw new HttpError(415, 'O conteúdo do arquivo não corresponde à extensão.');
    return { stream: createReadStream(target.absolute), mime, size: info.size };
  }

  /** Renomeia ou move, dentro da mesma seção, sem sobrescrever nada. */
  async move(fromInput: unknown, toInput: unknown): Promise<void> {
    const from = await this.resolve(fromInput);
    const to = await this.resolve(toInput);
    if (from.relative === from.section) throw badRequest('As pastas principais não podem ser alteradas.');
    if (from.section !== to.section) throw badRequest('Imagens e sons ficam cada um na sua pasta.');
    if (to.relative === to.section) throw badRequest('Escolha um nome.');
    if (to.relative === from.relative || to.relative.startsWith(`${from.relative}/`)) throw badRequest('Uma pasta não pode ir para dentro dela mesma.');
    const info = await lstat(from.absolute).catch(() => null);
    if (!info) throw notFound('Item não encontrado.');
    if (info.isFile() && !extensionAllowed(to.section, to.absolute)) throw badRequest('Mantenha uma extensão aceita.');
    if (await lstat(to.absolute).catch(() => null)) throw conflict('Já existe um item com esse nome.');
    await mkdir(dirname(to.absolute), { recursive: true });
    await rename(from.absolute, to.absolute);
  }

  /** Apaga um arquivo ou uma pasta com o conteúdo. Atalhos dentro dela são removidos sem seguir o destino. */
  async remove(input: unknown): Promise<void> {
    const target = await this.resolve(input);
    if (target.relative === target.section) throw badRequest('As pastas principais não podem ser excluídas.');
    if (!(await lstat(target.absolute).catch(() => null))) throw notFound('Item não encontrado.');
    await rm(target.absolute, { recursive: true });
  }

  /** Confere o caminho vindo do navegador: primeiro o texto, depois o que há no disco. */
  private async resolve(input: unknown): Promise<LibraryPath> {
    const target = parseLibraryPath(this.root, input);
    await assertInsideOnDisk(this.root, target.absolute);
    return target;
  }
}

/** O nome encontrado no disco é um caminho que o app aceitaria de volta? */
function isListable(root: string, path: string): boolean {
  try {
    parseLibraryPath(root, path);
    return true;
  } catch {
    return false;
  }
}
