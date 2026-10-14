/**
 * Descobre o tipo REAL de um arquivo pelos primeiros bytes ("magic numbers"), sem confiar no
 * nome nem no Content-Type enviados (ambos são escolhidos por quem envia).
 *
 * Só imagens raster e áudio são aceitos. Recusados de propósito:
 * - SVG: é XML e pode conter <script> (XSS ao abrir a imagem direto);
 * - HTML, PDF, executáveis e qualquer formato não listado.
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

const ascii = (buf: Uint8Array, start: number, text: string): boolean =>
  buf.length >= start + text.length && [...text].every((ch, i) => buf[start + i] === ch.charCodeAt(0));

const bytes = (buf: Uint8Array, start: number, values: number[]): boolean =>
  buf.length >= start + values.length && values.every((v, i) => buf[start + i] === v);

/** Tipo detectado, ou null se o formato não é aceito. */
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
  // MP4/M4A: caixa "ftyp" com marca de áudio
  if (ascii(buf, 4, 'ftyp') && (ascii(buf, 8, 'M4A ') || ascii(buf, 8, 'M4B ') || ascii(buf, 8, 'mp42') || ascii(buf, 8, 'isom'))) {
    return 'audio/mp4';
  }
  if (bytes(buf, 0, [0x1a, 0x45, 0xdf, 0xa3])) return 'audio/webm';
  return null;
}

/** É imagem? (imagens abrem inline; o resto também, mas com o tipo fixo detectado) */
export const isImage = (mime: string): boolean => mime.startsWith('image/');
