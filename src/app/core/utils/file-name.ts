/** Extensão de cada tipo que o servidor aceita (imagens raster e áudio; ver server/src/security/file-type.ts). */
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/webm': 'webm',
};

/**
 * Nome para enviar um arquivo ao servidor, que exige uma extensão coerente com o conteúdo.
 * Arquivo escolhido pelo usuário mantém o nome dele; Blob sem nome (cópia de uma imagem) ganha
 * "arquivo.<extensão do tipo>" ("arquivo" sem extensão se o tipo for desconhecido: o servidor recusa).
 */
export function uploadName(file: Blob): string {
  const name = 'name' in file && typeof file.name === 'string' ? file.name.trim() : '';
  if (/\.[a-z0-9]{1,8}$/i.test(name)) return name;
  const extension = EXTENSIONS[file.type.split(';')[0].trim().toLowerCase()];
  return extension ? `arquivo.${extension}` : 'arquivo';
}
