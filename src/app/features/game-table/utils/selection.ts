import { Point, Rect } from '../../../core/models/geometry.model';

/**
 * Seleção de tokens no mapa — funções puras, sem Angular.
 *
 * `ids` = tokens selecionados; `primary` = o principal (o último clicado), sempre dentro de `ids`.
 * O principal é o que a janela "Token", a ficha, "quem age" e as camadas usam; o grupo todo
 * se move, é removido e copiado junto.
 */
export interface TokenSelection {
  ids: ReadonlySet<string>;
  primary: string | null;
}

export const NO_SELECTION: TokenSelection = { ids: new Set(), primary: null };

/** Só este token (null = nada). */
export function selectOne(id: string | null): TokenSelection {
  return id ? { ids: new Set([id]), primary: id } : NO_SELECTION;
}

/** Shift+clique: entra na seleção (e vira o principal) ou sai dela. */
export function toggleInSelection(sel: TokenSelection, id: string): TokenSelection {
  if (!sel.ids.has(id)) return { ids: new Set([...sel.ids, id]), primary: id };
  return without(sel, [id]);
}

/** Caixa de seleção: estes tokens (`additive` = somados à seleção atual, com Shift). */
export function selectMany(sel: TokenSelection, ids: readonly string[], additive: boolean): TokenSelection {
  const next = new Set(additive ? [...sel.ids, ...ids] : ids);
  if (!next.size) return NO_SELECTION;
  const primary = sel.primary && next.has(sel.primary) ? sel.primary : (ids[0] ?? [...next][0]);
  return { ids: next, primary };
}

/** Tira tokens da seleção (removidos do mapa, fora da camada…); o principal passa a outro, se sobrar. */
export function without(sel: TokenSelection, ids: readonly string[]): TokenSelection {
  const gone = new Set(ids);
  if (![...sel.ids].some((id) => gone.has(id))) return sel;
  const next = new Set([...sel.ids].filter((id) => !gone.has(id)));
  if (!next.size) return NO_SELECTION;
  const primary = sel.primary && next.has(sel.primary) ? sel.primary : [...next][next.size - 1];
  return { ids: next, primary };
}

/** Mantém só os tokens que passam no filtro. */
export function keepOnly(sel: TokenSelection, keep: (id: string) => boolean): TokenSelection {
  return without(sel, [...sel.ids].filter((id) => !keep(id)));
}

/** Retângulo entre dois cantos quaisquer (arraste em qualquer direção). */
export function rectFromCorners(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

export function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

/** Posições de um grupo deslocado por `delta` (mantém a formação). */
export function shiftGroup<T extends { id: string; x: number; y: number }>(
  origins: readonly T[],
  delta: Point,
): { placementId: string; x: number; y: number }[] {
  return origins.map((o) => ({ placementId: o.id, x: o.x + delta.x, y: o.y + delta.y }));
}
