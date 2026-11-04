/**
 * Etiqueta com cor e nível opcional (ex.: "Envenenado", "Exaustão 2", "Mágico").
 * Usada nos tokens, na ficha de personagem e nos cartões de item.
 */
export interface Tag {
  id: string;
  text: string;
  color: string;
  /** Nível da etiqueta (ex.: exaustão 2). Ausente ou 0 = sem nível. */
  level?: number;
}

/** Paleta para etiquetas e barras (cores livres também são aceitas). */
export const TAG_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#2dd4bf',
  '#4f86f7', '#b18cff', '#f472b6', '#e8eefc', '#64748b',
  '#000000',
] as const;
