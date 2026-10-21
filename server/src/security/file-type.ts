/**
 * Tipo de um arquivo enviado, conferido em três frentes (BACKEND_SECURITY.md §8):
 * 1. os primeiros bytes ("magic numbers") dizem o tipo REAL — é o que vale e o que é servido;
 * 2. a extensão do nome precisa ser a desse tipo;
 * 3. o tipo declarado pelo navegador (MIME) precisa ser da mesma família, ou genérico.
 * Nome e MIME são escolhidos por quem envia: sozinhos não valem nada, mas uma divergência
 * (ex.: `foto.svg` com bytes de PNG) é recusada.
 *
 * Só imagens raster e áudio são aceitos. Recusados de propósito:
 * - SVG: é XML e pode conter <script> (XSS ao abrir a imagem direto);
 * - HTML, PDF, executáveis, vídeo e qualquer formato não listado.
 */

export type AllowedMime =
  | 'image/png'
  | 'image/jpeg'
  | 'image/gif'
  | 'image/webp'
  | 'audio/mpeg'
  | 'audio/ogg'
  | 'audio/wav'
  | 'audio/flac'
  | 'audio/mp4'
  | 'audio/webm';

/** Bytes do começo do arquivo que bastam para reconhecer qualquer tipo aceito. */
export const FILE_HEAD_BYTES = 16;

const ascii = (buf: Uint8Array, start: number, text: string): boolean =>
  buf.length >= start + text.length && [...text].every((ch, i) => buf[start + i] === ch.charCodeAt(0));

const bytes = (buf: Uint8Array, start: number, values: number[]): boolean =>
  buf.length >= start + values.length && values.every((v, i) => buf[start + i] === v);

/** Tipo detectado pelos primeiros bytes (`FILE_HEAD_BYTES` bastam), ou null se o formato não é aceito. */
export function detectFileType(buf: Uint8Array): AllowedMime | null {
  if (bytes(buf, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (bytes(buf, 0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (ascii(buf, 0, 'GIF87a') || ascii(buf, 0, 'GIF89a')) return 'image/gif';
  if (ascii(buf, 0, 'RIFF') && ascii(buf, 8, 'WEBP')) return 'image/webp';
  if (ascii(buf, 0, 'RIFF') && ascii(buf, 8, 'WAVE')) return 'audio/wav';
  if (ascii(buf, 0, 'OggS')) return 'audio/ogg';
  if (ascii(buf, 0, 'fLaC')) return 'audio/flac';
  if (ascii(buf, 0, 'ID3')) return 'audio/mpeg';
  // Quadro MPEG sem etiqueta ID3: 11 bits de sincronia + camada III
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe6) === 0xe2) return 'audio/mpeg';
  // MP4/M4A: caixa "ftyp" com marca de áudio (marcas genéricas só com extensão de áudio, abaixo)
  if (ascii(buf, 4, 'ftyp') && (ascii(buf, 8, 'M4A ') || ascii(buf, 8, 'M4B ') || ascii(buf, 8, 'mp42') || ascii(buf, 8, 'isom'))) {
    return 'audio/mp4';
  }
  if (bytes(buf, 0, [0x1a, 0x45, 0xdf, 0xa3])) return 'audio/webm';
  return null;
}

/** Extensões aceitas para cada tipo (sem `.mp4`: com marca genérica, seria um vídeo). */
const EXTENSIONS: Record<AllowedMime, readonly string[]> = {
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg', 'jfif'],
  'image/gif': ['gif'],
  'image/webp': ['webp'],
  'audio/mpeg': ['mp3'],
  'audio/ogg': ['ogg', 'oga', 'opus'],
  'audio/wav': ['wav'],
  'audio/flac': ['flac'],
  'audio/mp4': ['m4a', 'm4b', 'aac'],
  'audio/webm': ['weba', 'webm'],
};

/** Tipos declarados genéricos (o navegador não conhece a extensão): não dizem nada, não recusam. */
const GENERIC_DECLARED = new Set(['', 'application/octet-stream', 'binary/octet-stream']);

/**
 * O nome e o tipo declarado conferem com o tipo detectado? A extensão é obrigatória; o tipo
 * declarado pode ser genérico, mas, se específico, tem de ser da mesma família (contêineres de
 * áudio como OGG/WebM/M4A às vezes chegam como `video/*` ou `application/ogg`).
 */
export function declaredTypeMatches(filename: string, declaredMime: string, detected: AllowedMime): boolean {
  const extension = /\.([a-z0-9]{1,8})$/i.exec(filename)?.[1]?.toLowerCase();
  if (!extension || !EXTENSIONS[detected].includes(extension)) return false;
  const declared = declaredMime.split(';')[0].trim().toLowerCase();
  if (GENERIC_DECLARED.has(declared)) return true;
  if (detected.startsWith('image/')) return declared.startsWith('image/') && !declared.includes('svg');
  return declared.startsWith('audio/') || declared.startsWith('video/') || declared === 'application/ogg';
}
