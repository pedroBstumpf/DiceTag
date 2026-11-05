import { GameTable } from '../models/game-table.model';
import { DEFAULT_WORLD_ID, DEFAULT_WORLD_NAME, World, worldbuildKey } from '../models/world.model';
import { WorldItem } from '../models/world-item.model';

/**
 * Cópia do que está guardado no navegador, num arquivo só (funções puras, sem Angular).
 *
 * O navegador separa os dados por endereço: o que foi criado em localhost:4200 não aparece em
 * localhost:3000. Este arquivo leva mundos, mesas e imagens de um endereço para o outro, sem o
 * servidor precisar aceitar pedidos de outra origem, e serve de cópia de segurança.
 *
 * Formato: "ZEHENIA1" + tamanho do manifesto (4 bytes) + manifesto em JSON + arquivos, um depois do
 * outro. As imagens vão como estão, sem base64: nada precisa caber inteiro na memória.
 *
 * Só entram os dados do jogo (`isCopyKey`). Fora ficam `users`, que tem os hashes das senhas locais,
 * e as janelas abertas.
 */

export const COPY_EXTENSION = '.zehenia';
const MAGIC = 'ZEHENIA1';
const HEADER_BYTES = MAGIC.length + 4;
const COPY_FORMAT = 'zehenia-copia';
const COPY_VERSION = 1;

/** Um arquivo dentro da cópia: a posição vem da soma dos tamanhos dos anteriores. */
export interface CopyFile {
  id: string;
  type: string;
  size: number;
}

interface CopyManifest {
  format: typeof COPY_FORMAT;
  version: number;
  createdAt: number;
  data: Record<string, unknown>;
  files: CopyFile[];
}

/** Cópia aberta: os dados e o acesso a cada arquivo, sem ler o arquivo inteiro. */
export interface BrowserCopy {
  createdAt: number;
  data: Record<string, unknown>;
  fileIds: string[];
  file(id: string): Blob | undefined;
}

/** Um mundo guardado na cópia. `key` é a chave dele no navegador de origem. */
export interface CopyWorld {
  key: string;
  name: string;
  items: WorldItem[];
}

/** Uma mesa guardada na cópia. `state` ausente = mesa criada e nunca aberta. */
export interface CopyTable {
  table: GameTable;
  state: unknown;
  worldKey: string;
}

export interface CopyContents {
  worlds: CopyWorld[];
  tables: CopyTable[];
}

// --- Montar e abrir ------------------------------------------------------------------------------

/** O que vai para a cópia, além dos arquivos (`blob:<id>`). */
export function isCopyKey(key: string): boolean {
  return key === 'tables' || key.startsWith('worlds:') || key.startsWith('worldbuild:') || key.startsWith('table-state:');
}

export function buildCopy(data: Record<string, unknown>, files: { id: string; blob: Blob }[], createdAt: number): Blob {
  const manifest: CopyManifest = {
    format: COPY_FORMAT,
    version: COPY_VERSION,
    createdAt,
    data,
    files: files.map(({ id, blob }) => ({ id, type: blob.type, size: blob.size })),
  };
  const json = new TextEncoder().encode(JSON.stringify(manifest));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, json.length, true);
  return new Blob([MAGIC, length, json, ...files.map((f) => f.blob)], { type: 'application/octet-stream' });
}

const INVALID = 'Este arquivo não é uma cópia do app, ou está incompleto.';

/** Abre uma cópia, conferindo o formato. Arquivo inválido ou cortado dá erro, com o motivo. */
export async function readCopy(file: Blob): Promise<BrowserCopy> {
  const header = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
  if (header.length < HEADER_BYTES || new TextDecoder().decode(header.subarray(0, MAGIC.length)) !== MAGIC) throw new Error(INVALID);
  const length = new DataView(header.buffer, header.byteOffset).getUint32(MAGIC.length, true);
  if (HEADER_BYTES + length > file.size) throw new Error(INVALID);

  let manifest: CopyManifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(await file.slice(HEADER_BYTES, HEADER_BYTES + length).arrayBuffer())) as CopyManifest;
  } catch {
    throw new Error(INVALID);
  }
  if (manifest?.format !== COPY_FORMAT || !manifest.data || !Array.isArray(manifest.files)) throw new Error(INVALID);
  if (manifest.version > COPY_VERSION) throw new Error('Esta cópia foi feita por uma versão mais nova do app. Atualize o app.');

  const positions = new Map<string, { start: number; end: number; type: string }>();
  let start = HEADER_BYTES + length;
  for (const { id, size, type } of manifest.files) {
    positions.set(id, { start, end: start + size, type });
    start += size;
  }
  if (start > file.size) throw new Error(INVALID);
  return {
    createdAt: manifest.createdAt,
    data: manifest.data,
    fileIds: [...positions.keys()],
    file: (id) => {
      const place = positions.get(id);
      return place && file.slice(place.start, place.end, place.type);
    },
  };
}

// --- O que há dentro -----------------------------------------------------------------------------

/**
 * Mundos e mesas da cópia. Mundos vazios só aparecem se alguma mesa se passa neles.
 * Junta todas as contas locais: na cópia, nada é escondido por dono.
 */
export function copyContents(data: Record<string, unknown>): CopyContents {
  const worlds = new Map<string, CopyWorld>();
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith('worldbuild:') || !Array.isArray(value) || !value.length) continue;
    worlds.set(key, { key, name: worldNameOf(key, data), items: value as WorldItem[] });
  }
  const tables = ((data['tables'] ?? []) as GameTable[]).map((table): CopyTable => {
    const worldId = table.worldId ?? DEFAULT_WORLD_ID;
    const worldKey = worldbuildKey(table.ownerId, worldId);
    if (!worlds.has(worldKey)) worlds.set(worldKey, { key: worldKey, name: worldNameOf(worldKey, data), items: [] });
    return { table, state: data[`table-state:${table.id}`], worldKey };
  });
  return { worlds: [...worlds.values()], tables };
}

function worldNameOf(key: string, data: Record<string, unknown>): string {
  const [, userId, worldId = DEFAULT_WORLD_ID] = key.split(':');
  const list = (data[`worlds:${userId}`] ?? []) as World[];
  return list.find((w) => w.id === worldId)?.name ?? DEFAULT_WORLD_NAME;
}

// --- Levar uma mesa ao servidor ------------------------------------------------------------------

const isBlobField = (key: string) => /blobid$/i.test(key);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** Ids de todas as imagens e sons que o estado de uma mesa cita, sem repetir. */
export function stateBlobIds(state: unknown): string[] {
  const found = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!isRecord(value)) return;
    for (const [key, inner] of Object.entries(value)) {
      if (isBlobField(key) && typeof inner === 'string' && inner) found.add(inner);
      else visit(inner);
    }
  };
  visit(state);
  return [...found];
}

/**
 * Estado de uma mesa local pronto para o servidor:
 * - imagens e sons passam aos ids novos (o que não foi enviado perde a referência);
 * - contas locais não existem lá: o que a conta fez passa a ser do dono;
 * - personagens ficam sem dono, para cada amigo usar "Vincular à minha conta" no dele;
 * - o controle de NPCs é refeito na mesa, com os jogadores de verdade.
 */
export function stateForServer(state: unknown, newIds: ReadonlyMap<string, string>, ownerId: string): unknown {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!isRecord(value)) return value;
    const copy: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      if (isBlobField(key)) {
        const next = typeof inner === 'string' ? newIds.get(inner) : undefined;
        if (next) copy[key] = next;
      } else if (key === 'controllerUserId') {
        continue;
      } else if ((key === 'ownerUserId' || key === 'userId') && typeof inner === 'string') {
        copy[key] = ownerId;
      } else {
        copy[key] = visit(inner);
      }
    }
    return copy;
  };
  const copy = visit(state) as { entries?: Record<string, unknown>[] };
  for (const entry of copy.entries ?? []) {
    if (entry['kind'] === 'character') delete entry['ownerUserId'];
  }
  return copy;
}
