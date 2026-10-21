import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { FILE_HEAD_BYTES, detectFileType, type AllowedMime } from '../security/file-type';
import { HttpError } from './errors';

/** Arquivo recebido: tamanho, SHA-256 e o tipo detectado pelos primeiros bytes. */
export interface ReceivedFile {
  size: number;
  sha256: string;
  mime: AllowedMime;
}

const NOT_ACCEPTED = 'Formato não aceito. Envie PNG, JPEG, GIF, WebP ou áudio (MP3, OGG, WAV, FLAC, M4A, WebM).';

/**
 * Recebe um envio em **streaming** direto para `path` (BACKEND_SECURITY.md §8): o arquivo nunca
 * fica inteiro na memória. No caminho, conta os bytes, calcula o SHA-256 e reconhece o tipo pelos
 * primeiros bytes — formato não aceito interrompe o envio logo no começo, e passar de
 * `maxBytes` (o menor entre o limite por arquivo e o espaço que sobra nas cotas) também.
 * Em erro, quem chamou apaga `path`.
 */
export async function receiveUpload(source: Readable, path: string, maxBytes: number, tooBig: string): Promise<ReceivedFile> {
  const hash = createHash('sha256');
  let size = 0;
  let head = Buffer.alloc(0);
  let mime: AllowedMime | null = null;

  const identify = (): HttpError | null => {
    mime = detectFileType(head);
    return mime ? null : new HttpError(415, NOT_ACCEPTED);
  };

  const inspect = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      size += chunk.length;
      if (size > maxBytes) return done(new HttpError(413, tooBig));
      if (!mime && head.length < FILE_HEAD_BYTES) {
        head = Buffer.concat([head, chunk.subarray(0, FILE_HEAD_BYTES - head.length)]);
        if (head.length >= FILE_HEAD_BYTES) {
          const problem = identify();
          if (problem) return done(problem);
        }
      }
      hash.update(chunk);
      done(null, chunk);
    },
    // Arquivo menor que o cabeçalho: reconhece no fim
    flush(done) {
      done(!mime && size > 0 ? identify() : null);
    },
  });

  await pipeline(source, inspect, createWriteStream(path, { flags: 'wx', mode: 0o600 }));
  if (!size) throw new HttpError(400, 'Arquivo vazio.');
  return { size, sha256: hash.digest('hex'), mime: mime! };
}
