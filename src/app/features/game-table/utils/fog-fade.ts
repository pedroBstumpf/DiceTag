/**
 * Mistura entre quadros da névoa na mesa online — funções puras.
 *
 * A névoa muda no ritmo das mensagens da sala (rajadas de `BURST_MS` = 100 ms em
 * `TableSessionService`): trocar de uma vez faria a área visível andar aos saltos. A `FogLayer`
 * mistura então o quadro antigo com o novo ao longo de `FOG_FADE_MS`. Quadros que chegam um por
 * quadro de tela (arrasto desta própria tela) trocam na hora, para não ficarem atrasados.
 */

/** Duração da mistura: igual ao intervalo das rajadas, para cada quadro emendar no seguinte. */
export const FOG_FADE_MS = 100;
/** Quadros mais próximos que isto vêm desta tela (um por quadro de tela) e trocam na hora. */
export const FOG_FADE_MIN_GAP_MS = 50;

/** Misturar o quadro novo com o anterior? `sinceLastFrameMs` = tempo desde a mudança anterior. */
export function shouldFadeFog(smooth: boolean, sinceLastFrameMs: number): boolean {
  return smooth && sinceLastFrameMs >= FOG_FADE_MIN_GAP_MS;
}

/** Quanto do quadro novo aparece (0 a 1) depois de `elapsedMs` de mistura. */
export function fogFadeProgress(elapsedMs: number): number {
  return Math.min(1, Math.max(0, elapsedMs / FOG_FADE_MS));
}
