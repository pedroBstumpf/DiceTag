/**
 * Remove metadados de imagens (EXIF, XMP, IPTC, comentários) antes de enviá-las ao servidor: uma
 * foto de celular pode levar a localização de onde foi tirada, e os outros jogadores baixam o
 * arquivo. Trabalha nos bytes, sem redesenhar a imagem: não perde qualidade nem transparência, não
 * esbarra no limite de tamanho do `<canvas>` (mapas grandes) e preserva imagens animadas.
 *
 * Mantém o que muda a aparência: perfil de cor (ICC) e a orientação da foto, regravada sozinha.
 * Arquivo que não for reconhecido ou estiver malformado volta como veio: o servidor ainda confere o tipo.
 * Função pura, sem Angular.
 */

const JPEG_SOI = 0xd8;
const JPEG_SOS = 0xda;
const JPEG_EOI = 0xd9;
const JPEG_APP1 = 0xe1;
const JPEG_APP13 = 0xed;
const JPEG_COM = 0xfe;
/** Tag "Orientation" do EXIF. */
const EXIF_ORIENTATION = 0x0112;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Blocos de texto e EXIF do PNG (o resto descreve a imagem). */
const PNG_METADATA_CHUNKS = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

/** Bits do cabeçalho VP8X que dizem que o WebP tem EXIF (0x08) e XMP (0x04). */
const WEBP_METADATA_FLAGS = 0x08 | 0x04;

const ascii = (bytes: Uint8Array, start: number, length: number): string => String.fromCharCode(...bytes.subarray(start, start + length));

/** Mesmos bytes de volta quando não há o que tirar (a chamada pode reaproveitar o arquivo original). */
export function stripImageMetadata(bytes: Uint8Array): Uint8Array {
  try {
    if (bytes[0] === 0xff && bytes[1] === JPEG_SOI) return stripJpeg(bytes);
    if (PNG_SIGNATURE.every((value, i) => bytes[i] === value)) return stripPng(bytes);
    if (bytes.length > 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return stripWebp(bytes);
  } catch {
    // Arquivo malformado: fica como veio
  }
  return bytes;
}

/** Sem metadados, como um novo arquivo de mesmo nome e tipo (o original, se não havia nada a tirar). */
export async function withoutImageMetadata<T extends Blob>(file: T): Promise<T | File | Blob> {
  if (!file.type.startsWith('image/')) return file;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const clean = stripImageMetadata(bytes);
  if (clean === bytes) return file;
  const parts = [clean] as BlobPart[];
  return 'name' in file && typeof file.name === 'string' ? new File(parts, file.name, { type: file.type }) : new Blob(parts, { type: file.type });
}

// --- JPEG ---------------------------------------------------------------------------

/** Copia os segmentos até o início da imagem (SOS), sem os de metadados. */
function stripJpeg(bytes: Uint8Array): Uint8Array {
  const kept: Uint8Array[] = [bytes.subarray(0, 2)];
  let orientation = 1;
  let removed = false;
  let pos = 2;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) return bytes;
    const marker = bytes[pos + 1];
    if (marker === JPEG_SOS || marker === JPEG_EOI) break;
    const length = (bytes[pos + 2] << 8) | bytes[pos + 3];
    if (length < 2 || pos + 2 + length > bytes.length) return bytes;
    const segment = bytes.subarray(pos, pos + 2 + length);
    if (marker === JPEG_APP1 || marker === JPEG_APP13 || marker === JPEG_COM) {
      if (marker === JPEG_APP1) orientation = exifOrientation(segment) ?? orientation;
      removed = true;
    } else {
      kept.push(segment);
    }
    pos += 2 + length;
  }
  if (!removed) return bytes;
  // A orientação muda como a foto aparece: volta sozinha, logo depois do início do arquivo
  if (orientation !== 1) kept.splice(1, 0, orientationSegment(orientation));
  kept.push(bytes.subarray(pos));
  return concat(kept);
}

/** Orientação gravada num segmento APP1 de EXIF (undefined = não é EXIF ou não a tem). */
function exifOrientation(segment: Uint8Array): number | undefined {
  // FF E1 + 2 bytes de tamanho + "Exif\0\0" + cabeçalho TIFF
  if (segment.length < 22 || ascii(segment, 4, 4) !== 'Exif') return undefined;
  const tiff = 10;
  const order = ascii(segment, tiff, 2);
  if (order !== 'II' && order !== 'MM') return undefined;
  const little = order === 'II';
  const u16 = (at: number) => (little ? segment[at] | (segment[at + 1] << 8) : (segment[at] << 8) | segment[at + 1]);
  const u32 = (at: number) => (little ? u16(at) + u16(at + 2) * 65536 : u16(at) * 65536 + u16(at + 2));
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > segment.length) return undefined;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > segment.length) return undefined;
    if (u16(entry) === EXIF_ORIENTATION) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : undefined;
    }
  }
  return undefined;
}

/** Segmento APP1 mínimo, só com a orientação (nada de localização, câmera ou data). */
function orientationSegment(orientation: number): Uint8Array {
  return Uint8Array.from([
    0xff, JPEG_APP1, 0x00, 0x22,
    // "Exif\0\0"
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    // TIFF little-endian, primeiro diretório logo depois do cabeçalho
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
    // Uma entrada: tag 0x0112, tipo SHORT, 1 valor
    0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00,
    // Sem próximo diretório
    0x00, 0x00, 0x00, 0x00,
  ]);
}

// --- PNG ----------------------------------------------------------------------------

function stripPng(bytes: Uint8Array): Uint8Array {
  const kept: Uint8Array[] = [bytes.subarray(0, 8)];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let removed = false;
  let pos = 8;
  while (pos + 12 <= bytes.length) {
    const size = 12 + view.getUint32(pos);
    if (pos + size > bytes.length) return bytes;
    const type = ascii(bytes, pos + 4, 4);
    if (PNG_METADATA_CHUNKS.has(type)) removed = true;
    else kept.push(bytes.subarray(pos, pos + size));
    pos += size;
    if (type === 'IEND') break;
  }
  return removed ? concat(kept) : bytes;
}

// --- WebP ---------------------------------------------------------------------------

function stripWebp(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kept: Uint8Array[] = [];
  let removed = false;
  let pos = 12;
  while (pos + 8 <= bytes.length) {
    // Cada bloco: 4 bytes de tipo + 4 de tamanho + dados
    const size = view.getUint32(pos + 4, true);
    // Blocos têm tamanho par (um byte de preenchimento quando é ímpar)
    const total = 8 + size + (size % 2);
    if (pos + 8 + size > bytes.length) return bytes;
    const type = ascii(bytes, pos, 4);
    if (type === 'EXIF' || type === 'XMP ') removed = true;
    else kept.push(bytes.subarray(pos, Math.min(pos + total, bytes.length)));
    pos += total;
  }
  if (!removed) return bytes;
  const body = concat(kept);
  // Tira do cabeçalho estendido o aviso de que há metadados
  if (ascii(body, 0, 4) === 'VP8X') body[8] &= ~WEBP_METADATA_FLAGS;
  const header = new Uint8Array(12);
  header.set(bytes.subarray(0, 12));
  new DataView(header.buffer).setUint32(4, body.length + 4, true);
  return concat([header, body]);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
