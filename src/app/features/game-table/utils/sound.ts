/** Abaixo disto a diferença não se ouve: quem acabou de receber o comando começa do início. */
const SEEK_MIN_SECONDS = 0.5;

/**
 * Ponto da faixa (em segundos) para quem entra agora ouvir o mesmo que os outros.
 * `elapsedMs`: tempo desde o início da faixa (negativo se o relógio desta máquina estiver atrasado).
 * Com repetição, dá a volta; sem repetição, null = a faixa já acabou. Duração desconhecida (ainda não
 * lida ou transmissão) começa do início.
 */
export function trackOffset(elapsedMs: number, duration: number, loop: boolean): number | null {
  const seconds = elapsedMs / 1000;
  if (seconds < SEEK_MIN_SECONDS || !Number.isFinite(duration) || duration <= 0) return 0;
  if (loop) return seconds % duration;
  return seconds >= duration ? null : seconds;
}
