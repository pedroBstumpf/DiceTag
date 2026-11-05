import { lstat, realpath } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { HttpError } from '../lib/errors';
import type { AllowedMime } from './file-type';

/**
 * Regras que prendem a biblioteca de arquivos à pasta dela (ver `services/library.service.ts`).
 *
 * Primeira camada de duas: aqui, todo caminho vindo do navegador é conferido antes de tocar no
 * disco. A segunda é do sistema: `npm run mesa` roda o servidor com o modelo de permissões do Node,
 * que recusa ler ou gravar fora das pastas autorizadas, mesmo que esta camada tivesse um defeito.
 */

/** Pastas fixas da biblioteca: nada é guardado fora delas. */
export const LIBRARY_SECTIONS = ['imagens', 'sons'] as const;
export type LibrarySection = (typeof LIBRARY_SECTIONS)[number];

/** Extensões de cada pasta. SVG e o resto ficam de fora: `security/file-type.ts`. */
const SECTION_EXTENSIONS: Record<LibrarySection, ReadonlySet<string>> = {
  imagens: new Set(['.png', '.jpg', '.jpeg', '.jfif', '.gif', '.webp']),
  sons: new Set(['.mp3', '.ogg', '.oga', '.opus', '.wav', '.flac', '.m4a', '.m4b', '.aac', '.weba', '.webm']),
};

const MAX_PATH_LENGTH = 1024;
const MAX_NAME_LENGTH = 120;
/** Fora do que o Windows aceita num nome; `:` também abriria fluxos alternativos (ADS) do NTFS. */
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[\u0000-\u001f\u007f<>:"/\\|?*]/;
/** Nomes que o Windows reserva, com ou sem extensão (ex.: `CON`, `nul.txt`). */
const RESERVED_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

const invalid = () => new HttpError(400, 'Caminho inválido.');

/** Um trecho do caminho é um nome comum? Recusa `.`, `..`, separadores, reservados e nomes ocultos. */
export function isSafeName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= MAX_NAME_LENGTH &&
    !name.startsWith('.') &&
    !name.endsWith('.') &&
    !name.endsWith(' ') &&
    !FORBIDDEN_CHARS.test(name) &&
    !RESERVED_NAME.test(name)
  );
}

/** Caminho relativo já conferido (`imagens/mapas/ponte.png`). */
export interface LibraryPath {
  section: LibrarySection;
  /** Caminho com `/`, como o navegador conhece. */
  relative: string;
  /** Caminho no disco, dentro da raiz. */
  absolute: string;
}

/**
 * Confere um caminho vindo do navegador, sem tocar no disco: só aceita nomes comuns separados por
 * `/`, começando por uma das pastas da biblioteca. Absolutos, `..`, `\`, unidades (`C:`), caminhos
 * de rede e fluxos alternativos são recusados. A checagem final confirma que o resultado está
 * dentro da raiz. Lança 400; quem chama nunca vê um caminho fora da biblioteca.
 */
export function parseLibraryPath(root: string, input: unknown): LibraryPath {
  if (typeof input !== 'string' || !input || input.length > MAX_PATH_LENGTH) throw invalid();
  const parts = input.split('/');
  if (!parts.every(isSafeName)) throw invalid();
  const section = parts[0] as LibrarySection;
  if (!LIBRARY_SECTIONS.includes(section)) throw invalid();
  const base = resolve(root);
  const absolute = resolve(base, ...parts);
  if (!absolute.startsWith(base + sep)) throw invalid();
  return { section, relative: parts.join('/'), absolute };
}

/**
 * Confirma no disco que o caminho continua dentro da raiz: atalhos (links simbólicos e junções do
 * Windows) colocados na pasta poderiam apontar para fora. O caminho em si não pode ser um atalho, e
 * o trecho que já existe, com os atalhos resolvidos, precisa estar dentro da raiz resolvida.
 */
export async function assertInsideOnDisk(root: string, target: string): Promise<void> {
  const realRoot = await realpath(resolve(root));
  const stat = await lstat(target).catch(() => null);
  if (stat?.isSymbolicLink()) throw invalid();
  let existing = stat ? target : dirname(target);
  // Sobe até o que já existe (ao criar pastas e arquivos novos)
  while (!(await lstat(existing).catch(() => null))) {
    const parent = dirname(existing);
    if (parent === existing) throw invalid();
    existing = parent;
  }
  const real = await realpath(existing);
  if (real !== realRoot && !real.startsWith(realRoot + sep)) throw invalid();
}

/** A extensão é aceita nesta pasta? */
export function extensionAllowed(section: LibrarySection, name: string): boolean {
  return SECTION_EXTENSIONS[section].has(extname(name).toLowerCase());
}

/** O tipo real do arquivo (pelos bytes) é o desta pasta? */
export function mimeMatchesSection(section: LibrarySection, mime: AllowedMime): boolean {
  return mime.startsWith(section === 'imagens' ? 'image/' : 'audio/');
}

/**
 * Nome seguro para um arquivo enviado: só o último trecho do nome original, sem caracteres
 * proibidos nem pontos e espaços nas pontas, dentro do limite e mantendo a extensão.
 */
export function safeFileName(original: string): string {
  const base = original.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  let name = base.normalize('NFC').replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '-').trim();
  name = name.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  const extension = extname(name).slice(0, 12);
  const stem = name.slice(0, name.length - extname(name).length).slice(0, MAX_NAME_LENGTH - extension.length).trim() || 'arquivo';
  const result = `${stem}${extension}`;
  return RESERVED_NAME.test(result) ? `_${result}` : result;
}

/** Nome livre na pasta: `ponte.png`, `ponte (2).png`… (`taken` confere se já existe). */
export async function freeName(name: string, taken: (candidate: string) => Promise<boolean>): Promise<string> {
  if (!(await taken(name))) return name;
  const extension = extname(name);
  const stem = name.slice(0, name.length - extension.length);
  for (let n = 2; n < 10_000; n++) {
    const candidate = `${stem} (${n})${extension}`;
    if (!(await taken(candidate))) return candidate;
  }
  throw new HttpError(409, 'Já há arquivos demais com esse nome.');
}
