import { Point } from '../../../core/models/geometry.model';

/**
 * Geometria e layout da linha do tempo em mapa mental — funções puras, sem Angular.
 * Posições são o canto superior esquerdo de cada cartão, em coordenadas do quadro.
 */

/** Tamanho de um cartão de evento (usado para ancorar setas e calcular layouts). */
export const TIMELINE_CARD = { width: 220, height: 112 } as const;

/** Espaço entre colunas e linhas nos layouts automáticos. */
const GAP_X = 90;
const GAP_Y = 36;

/** Lado de um cartão (alças de criação/conexão). */
export type CardSide = 'top' | 'right' | 'bottom' | 'left';

interface Positioned {
  id: string;
  x: number;
  y: number;
}

interface LinkLike {
  from: string;
  to: string;
}

// --- Layouts -----------------------------------------------------------------

/** Posições em coluna, um evento abaixo do outro (migração de linhas antigas). */
export function columnLayout(count: number): Point[] {
  return Array.from({ length: count }, (_, i) => ({ x: 0, y: i * (TIMELINE_CARD.height + GAP_Y) }));
}

/**
 * Layout em árvore, da esquerda para a direita.
 * Começa pelos eventos sem conexões de entrada; cada evento fica uma coluna
 * depois do seu antecessor mais distante. Dentro da coluna, a ordem segue a
 * posição média dos antecessores. Ciclos são quebrados no primeiro evento pendente.
 */
export function treeLayout(ids: string[], links: LinkLike[]): Map<string, Point> {
  const known = new Set(ids);
  const valid = links.filter((l) => known.has(l.from) && known.has(l.to) && l.from !== l.to);

  const children = new Map(ids.map((id) => [id, [] as string[]]));
  const parents = new Map(ids.map((id) => [id, [] as string[]]));
  const pending = new Map(ids.map((id) => [id, 0]));
  for (const l of valid) {
    children.get(l.from)!.push(l.to);
    parents.get(l.to)!.push(l.from);
    pending.set(l.to, pending.get(l.to)! + 1);
  }

  // Ordem topológica (Kahn) com profundidade = maior caminho a partir de uma raiz
  const depth = new Map<string, number>();
  const order: string[] = [];
  const done = new Set<string>();
  const queue = ids.filter((id) => pending.get(id) === 0);

  while (order.length < ids.length) {
    if (!queue.length) {
      // Só restam ciclos: força o primeiro evento pendente como raiz
      queue.push(ids.find((id) => !done.has(id))!);
    }
    const id = queue.shift()!;
    if (done.has(id)) continue;
    done.add(id);
    order.push(id);
    const d = depth.get(id) ?? 0;
    depth.set(id, d);
    for (const child of children.get(id)!) {
      if (done.has(child)) continue;
      depth.set(child, Math.max(depth.get(child) ?? 0, d + 1));
      pending.set(child, pending.get(child)! - 1);
      if (pending.get(child)! <= 0) queue.push(child);
    }
  }

  // Agrupa por coluna mantendo a ordem de descoberta
  const columns: string[][] = [];
  for (const id of order) (columns[depth.get(id)!] ??= []).push(id);

  const positions = new Map<string, Point>();
  const rank = new Map(order.map((id, i) => [id, i]));
  columns.forEach((column, col) => {
    // Ordena pela altura média dos antecessores já posicionados
    const parentY = (id: string): number => {
      const ys = parents.get(id)!.flatMap((p) => (positions.has(p) ? [positions.get(p)!.y] : []));
      return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : Number.POSITIVE_INFINITY;
    };
    const sorted = [...column].sort((a, b) => parentY(a) - parentY(b) || rank.get(a)! - rank.get(b)!);
    const step = TIMELINE_CARD.height + GAP_Y;
    sorted.forEach((id, row) => {
      positions.set(id, { x: col * (TIMELINE_CARD.width + GAP_X), y: (row - (sorted.length - 1) / 2) * step });
    });
  });
  return positions;
}

/**
 * Posição para um novo evento criado a partir de `from`, no lado indicado.
 * Se o lugar estiver ocupado, desce (ou vai para a direita) até achar espaço livre.
 */
export function placeConnected(from: Point, side: CardSide, others: Point[]): Point {
  const { width: w, height: h } = TIMELINE_CARD;
  const offset: Record<CardSide, Point> = {
    right: { x: w + GAP_X, y: 0 },
    left: { x: -(w + GAP_X), y: 0 },
    bottom: { x: 0, y: h + GAP_Y + 24 },
    top: { x: 0, y: -(h + GAP_Y + 24) },
  };
  const shift: Point = side === 'left' || side === 'right' ? { x: 0, y: h + GAP_Y } : { x: w + GAP_X / 2, y: 0 };

  let spot = { x: from.x + offset[side].x, y: from.y + offset[side].y };
  for (let i = 0; i < 50 && others.some((o) => overlaps(o, spot)); i++) {
    spot = { x: spot.x + shift.x, y: spot.y + shift.y };
  }
  return spot;
}

// --- Setas ---------------------------------------------------------------------

/**
 * Caminho SVG (curva cúbica) entre dois cartões, o ponto do meio (para o rótulo)
 * e a ponta da seta (triângulo, sem <marker>, que falha com <base href> em alguns navegadores).
 * A seta sai pela lateral (ou topo/base) voltada para o outro cartão.
 */
export function linkPath(from: Point, to: Point): { d: string; mid: Point; arrow: string } {
  const { width: w, height: h } = TIMELINE_CARD;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  // Compara proporcionalmente ao formato do cartão (mais largo que alto)
  const horizontal = Math.abs(dx) * h >= Math.abs(dy) * w;

  let p0: Point, p3: Point, c1: Point, c2: Point;
  if (horizontal) {
    const dir = dx >= 0 ? 1 : -1;
    p0 = { x: from.x + (dir > 0 ? w : 0), y: from.y + h / 2 };
    p3 = { x: to.x + (dir > 0 ? 0 : w), y: to.y + h / 2 };
    const k = Math.max(40, Math.abs(p3.x - p0.x) / 2) * dir;
    c1 = { x: p0.x + k, y: p0.y };
    c2 = { x: p3.x - k, y: p3.y };
  } else {
    const dir = dy >= 0 ? 1 : -1;
    p0 = { x: from.x + w / 2, y: from.y + (dir > 0 ? h : 0) };
    p3 = { x: to.x + w / 2, y: to.y + (dir > 0 ? 0 : h) };
    const k = Math.max(30, Math.abs(p3.y - p0.y) / 2) * dir;
    c1 = { x: p0.x, y: p0.y + k };
    c2 = { x: p3.x, y: p3.y - k };
  }

  // Ponto da curva em t = 0,5
  const mid = {
    x: (p0.x + 3 * c1.x + 3 * c2.x + p3.x) / 8,
    y: (p0.y + 3 * c1.y + 3 * c2.y + p3.y) / 8,
  };

  // Ponta da seta alinhada à tangente final da curva (de c2 para p3)
  const len = Math.hypot(p3.x - c2.x, p3.y - c2.y) || 1;
  const ux = (p3.x - c2.x) / len;
  const uy = (p3.y - c2.y) / len;
  const base = { x: p3.x - ux * 10, y: p3.y - uy * 10 };
  const arrow = [
    `${p3.x},${p3.y}`,
    `${base.x - uy * 5},${base.y + ux * 5}`,
    `${base.x + uy * 5},${base.y - ux * 5}`,
  ].join(' ');

  return { d: `M${p0.x},${p0.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${p3.x},${p3.y}`, mid, arrow };
}

/** Ponto de onde sai uma alça (meio do lado do cartão). */
export function sideAnchor(card: Point, side: CardSide): Point {
  const { width: w, height: h } = TIMELINE_CARD;
  return {
    top: { x: card.x + w / 2, y: card.y },
    right: { x: card.x + w, y: card.y + h / 2 },
    bottom: { x: card.x + w / 2, y: card.y + h },
    left: { x: card.x, y: card.y + h / 2 },
  }[side];
}

/** Cartão sob um ponto do quadro (o último da lista fica por cima). */
export function cardAt<T extends Positioned>(cards: T[], p: Point): T | undefined {
  for (let i = cards.length - 1; i >= 0; i--) {
    const c = cards[i];
    if (p.x >= c.x && p.x <= c.x + TIMELINE_CARD.width && p.y >= c.y && p.y <= c.y + TIMELINE_CARD.height) return c;
  }
  return undefined;
}

/** Retângulo que envolve todos os cartões. */
export function cardsBounds(cards: Point[]): { x: number; y: number; width: number; height: number } | null {
  if (!cards.length) return null;
  const xs = cards.map((c) => c.x);
  const ys = cards.map((c) => c.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) + TIMELINE_CARD.width - x, height: Math.max(...ys) + TIMELINE_CARD.height - y };
}

function overlaps(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < TIMELINE_CARD.width && Math.abs(a.y - b.y) < TIMELINE_CARD.height;
}
