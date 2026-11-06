import { FOG_FADE_MIN_GAP_MS, FOG_FADE_MS, fogFadeProgress, shouldFadeFog } from './fog-fade';

describe('mistura entre quadros da névoa', () => {
  it('fora da mesa online, troca na hora', () => {
    expect(shouldFadeFog(false, 1000)).toBe(false);
  });

  it('quadros da rede (espaçados) se misturam', () => {
    expect(shouldFadeFog(true, 100)).toBe(true);
    expect(shouldFadeFog(true, FOG_FADE_MIN_GAP_MS)).toBe(true);
  });

  it('quadros seguidos (arrasto desta tela, um por quadro) trocam na hora', () => {
    expect(shouldFadeFog(true, 16)).toBe(false);
    expect(shouldFadeFog(true, FOG_FADE_MIN_GAP_MS - 1)).toBe(false);
  });

  it('o progresso vai de 0 a 1 em FOG_FADE_MS e fica preso nos limites', () => {
    expect(fogFadeProgress(-5)).toBe(0);
    expect(fogFadeProgress(0)).toBe(0);
    expect(fogFadeProgress(FOG_FADE_MS / 2)).toBeCloseTo(0.5);
    expect(fogFadeProgress(FOG_FADE_MS)).toBe(1);
    expect(fogFadeProgress(FOG_FADE_MS * 3)).toBe(1);
  });
});
