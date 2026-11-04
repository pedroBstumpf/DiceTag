/**
 * Auxiliares de cor puros (sem Angular).
 */

/** Texto escuro (ink-950) para fundos claros. */
const DARK_TEXT = '#04060c';
/** Texto claro para fundos escuros. */
const LIGHT_TEXT = '#ffffff';

/**
 * Cor de texto legível sobre o fundo `background` (hex "#rgb" ou "#rrggbb"): escura em cores
 * claras e branca em cores escuras (ex.: etiqueta preta). Cor que não é hex = texto escuro.
 */
export function readableTextOn(background: string): string {
  const hex = background.trim().replace('#', '');
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return DARK_TEXT;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  // Luminância percebida (aproximação rápida, suficiente para escolher entre claro e escuro)
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance < 0.45 ? LIGHT_TEXT : DARK_TEXT;
}
