import { uploadName } from './file-name';

describe('uploadName (nome do arquivo enviado ao servidor)', () => {
  it('arquivo escolhido pelo usuário mantém o nome', () => {
    expect(uploadName(new File(['x'], 'Mapa da Taverna.PNG', { type: 'image/png' }))).toBe('Mapa da Taverna.PNG');
  });

  it('Blob sem nome ganha a extensão do tipo', () => {
    expect(uploadName(new Blob(['x'], { type: 'image/jpeg' }))).toBe('arquivo.jpg');
    expect(uploadName(new Blob(['x'], { type: 'audio/ogg; codecs=opus' }))).toBe('arquivo.ogg');
  });

  it('arquivo sem extensão usa a do tipo', () => {
    expect(uploadName(new File(['x'], 'retrato', { type: 'image/webp' }))).toBe('arquivo.webp');
  });

  it('tipo desconhecido fica sem extensão (o servidor recusa)', () => {
    expect(uploadName(new Blob(['x'], { type: 'image/svg+xml' }))).toBe('arquivo');
    expect(uploadName(new Blob(['x']))).toBe('arquivo');
  });
});
