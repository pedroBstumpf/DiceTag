import { stripImageMetadata, withoutImageMetadata } from './image-metadata';

const text = (s: string) => [...s].map((c) => c.charCodeAt(0));
/** Marcador da localização nos arquivos de teste: não pode sobrar nos bytes. */
const GPS = text('GPS-LOCALIZACAO-SECRETA');
const hasGps = (bytes: Uint8Array) => String.fromCharCode(...bytes).includes('GPS-LOCALIZACAO');

// --- JPEG ---------------------------------------------------------------------------

const segment = (marker: number, data: number[]) => [0xff, marker, (data.length + 2) >> 8, (data.length + 2) & 0xff, ...data];
/** EXIF (little ou big endian) com a orientação e o marcador de localização. */
function exif(orientation: number, little = true): number[] {
  const u16 = (v: number) => (little ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff]);
  const u32 = (v: number) => (little ? [v & 0xff, 0, 0, 0] : [0, 0, 0, v & 0xff]);
  return segment(0xe1, [...text('Exif\0\0'), ...text(little ? 'II' : 'MM'), ...u16(42), ...u32(8), ...u16(1), ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0, ...u32(0), ...GPS]);
}
const JFIF = segment(0xe0, text('JFIF\0'));
const ICC = segment(0xe2, text('ICC_PROFILE'));
/** Cabeçalho de imagem + dados comprimidos (precisam ficar idênticos). */
const IMAGE = [...segment(0xdb, [1, 2, 3]), 0xff, 0xda, 0x00, 0x02, 9, 8, 7, 0xff, 0xd9];
const jpeg = (...parts: number[][]) => Uint8Array.from([0xff, 0xd8, ...parts.flat()]);

describe('stripImageMetadata: JPEG', () => {
  it('tira EXIF, XMP, IPTC e comentário; mantém perfil de cor e os dados da imagem', () => {
    const out = stripImageMetadata(jpeg(JFIF, exif(1), segment(0xe1, text('http://ns.adobe.com/xap/')), segment(0xed, GPS), segment(0xfe, GPS), ICC, IMAGE));
    expect(hasGps(out)).toBe(false);
    expect(String.fromCharCode(...out)).not.toContain('adobe');
    expect([...out]).toEqual([0xff, 0xd8, ...JFIF, ...ICC, ...IMAGE]);
  });

  it('a foto girada continua girada: a orientação é regravada, e só ela', () => {
    const out = stripImageMetadata(jpeg(JFIF, exif(6), IMAGE));
    expect(hasGps(out)).toBe(false);
    // O segmento novo fica logo depois do início e informa a orientação 6
    expect([out[2], out[3]]).toEqual([0xff, 0xe1]);
    expect(String.fromCharCode(...out.subarray(6, 10))).toBe('Exif');
    expect(out[30]).toBe(6);
    expect(out.length).toBe(2 + 36 + JFIF.length + IMAGE.length);
  });

  it('lê a orientação também em arquivos big-endian', () => {
    const out = stripImageMetadata(jpeg(exif(3, false), IMAGE));
    expect(out[30]).toBe(3);
  });

  it('sem metadados: devolve os mesmos bytes', () => {
    const clean = jpeg(JFIF, ICC, IMAGE);
    expect(stripImageMetadata(clean)).toBe(clean);
  });

  it('malformado (segmento maior que o arquivo): fica como veio', () => {
    const bad = Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 1, 2, 3]);
    expect(stripImageMetadata(bad)).toBe(bad);
  });
});

// --- PNG ----------------------------------------------------------------------------

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const chunk = (type: string, data: number[]) => [0, 0, data.length >> 8, data.length & 0xff, ...text(type), ...data, 1, 2, 3, 4];

describe('stripImageMetadata: PNG', () => {
  const base = [...chunk('IHDR', [1, 2]), ...chunk('IDAT', [3, 4]), ...chunk('IEND', [])];

  it('tira blocos de texto e EXIF e mantém o resto, com a transparência', () => {
    const png = Uint8Array.from([...SIGNATURE, ...chunk('IHDR', [1, 2]), ...chunk('eXIf', GPS), ...chunk('tEXt', GPS), ...chunk('iTXt', GPS), ...chunk('tRNS', [9]), ...chunk('IDAT', [3, 4]), ...chunk('IEND', [])]);
    const out = stripImageMetadata(png);
    expect(hasGps(out)).toBe(false);
    expect([...out]).toEqual([...SIGNATURE, ...chunk('IHDR', [1, 2]), ...chunk('tRNS', [9]), ...chunk('IDAT', [3, 4]), ...chunk('IEND', [])]);
  });

  it('sem metadados: devolve os mesmos bytes', () => {
    const clean = Uint8Array.from([...SIGNATURE, ...base]);
    expect(stripImageMetadata(clean)).toBe(clean);
  });
});

// --- WebP ---------------------------------------------------------------------------

const le32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff];
const riffChunk = (type: string, data: number[]) => [...text(type), ...le32(data.length), ...data, ...(data.length % 2 ? [0] : [])];
const webp = (...chunks: number[][]) => {
  const body = chunks.flat();
  return Uint8Array.from([...text('RIFF'), ...le32(body.length + 4), ...text('WEBP'), ...body]);
};

describe('stripImageMetadata: WebP', () => {
  const vp8x = riffChunk('VP8X', [0x08 | 0x04 | 0x10, 0, 0, 0, 1, 0, 0, 1, 0, 0]);
  const image = riffChunk('VP8 ', [1, 2, 3]);

  it('tira EXIF e XMP, ajusta o cabeçalho e o tamanho', () => {
    const out = stripImageMetadata(webp(vp8x, image, riffChunk('EXIF', GPS), riffChunk('XMP ', GPS)));
    expect(hasGps(out)).toBe(false);
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    expect(view.getUint32(4, true)).toBe(out.length - 8);
    // Só os avisos de metadados saem do cabeçalho: o de transparência (0x10) fica
    expect(out[20]).toBe(0x10);
    expect(String.fromCharCode(...out)).toContain('VP8 ');
  });

  it('sem metadados: devolve os mesmos bytes', () => {
    const clean = webp(riffChunk('VP8 ', [1, 2, 3]));
    expect(stripImageMetadata(clean)).toBe(clean);
  });
});

// --- Outros formatos e arquivo inteiro ---------------------------------------------

describe('withoutImageMetadata', () => {
  it('formato não reconhecido fica como veio', () => {
    const gif = Uint8Array.from(text('GIF89a...'));
    expect(stripImageMetadata(gif)).toBe(gif);
  });

  it('não mexe em áudio nem em arquivo sem metadados', async () => {
    const audio = new File([Uint8Array.from(text('ID3xx'))], 'trilha.mp3', { type: 'audio/mpeg' });
    expect(await withoutImageMetadata(audio)).toBe(audio);
    const clean = new File([jpeg(JFIF, IMAGE)] as BlobPart[], 'foto.jpg', { type: 'image/jpeg' });
    expect(await withoutImageMetadata(clean)).toBe(clean);
  });

  it('mantém o nome e o tipo do arquivo', async () => {
    const photo = new File([jpeg(JFIF, exif(1), IMAGE)] as BlobPart[], 'foto.jpg', { type: 'image/jpeg' });
    const out = (await withoutImageMetadata(photo)) as File;
    expect(out.name).toBe('foto.jpg');
    expect(out.type).toBe('image/jpeg');
    expect(out.size).toBeLessThan(photo.size);
    const blob = (await withoutImageMetadata(new Blob([jpeg(exif(1), IMAGE)] as BlobPart[], { type: 'image/jpeg' }))) as Blob;
    expect(blob.type).toBe('image/jpeg');
  });
});
