import { Point } from '../../../core/models/geometry.model';
import { FX_KINDS, FxKind } from '../../../core/models/table-session.model';

/**
 * Efeitos especiais do mapa, descritos como dados (sem Angular).
 *
 * `buildFx` transforma um lançamento (forma, cor, origem, alvo) num `FxDrawing`:
 * gradientes + partes SVG (com atributos e animação CSS). A camada fx-layer só
 * desenha essas partes; as animações são os @keyframes fx-* de tailwind.css.
 *
 * Referencial local: origem no início do arraste. Efeitos com direção giram para que
 * o eixo X aponte para o alvo (comprimento L); efeitos radiais não giram (raio = L),
 * então "para cima" continua sendo para cima na tela (fumaça, cura, teleporte).
 *
 * A aleatoriedade vem de `ctx.random` (semeada): o mesmo lançamento desenha sempre igual.
 */

// --- Tipos -------------------------------------------------------------------

export type FxTag = 'g' | 'path' | 'circle' | 'ellipse' | 'line' | 'polyline' | 'polygon' | 'rect';

/** Animação CSS de uma parte (nome = @keyframes fx-*). */
export interface FxAnim {
  name: string;
  duration: number;
  delay?: number;
  easing?: string;
  iterations?: number;
}

/** Um elemento SVG do efeito. `g` agrupa `children` (ex.: grupo que gira ou viaja). */
export interface FxPart {
  tag: FxTag;
  attrs: Record<string, string | number>;
  /** CSS fixo da parte (origem da transformação, variáveis --dx, --rot…). */
  css?: string;
  anim?: FxAnim;
  children?: FxPart[];
}

export interface FxStop {
  offset: number;
  color: string;
  opacity?: number;
}

export interface FxGradient {
  id: string;
  type: 'radial' | 'linear';
  stops: FxStop[];
  /** linear: de cima para baixo (padrão: da esquerda para a direita). */
  vertical?: boolean;
}

/** Efeito pronto para desenhar. */
export interface FxDrawing {
  /** Posiciona o referencial local no mapa (translate + rotate). */
  transform: string;
  gradients: FxGradient[];
  parts: FxPart[];
  /** Tempo total (ms) até a última parte terminar. */
  duration: number;
  /** Na vista isométrica fica "em pé" (coisas que sobem: cura, fumaça, teleporte); os demais ficam no chão. */
  upright: boolean;
}

/** Efeitos desenhados de pé na vista isométrica. */
const UPRIGHT_FX: ReadonlySet<FxKind> = new Set<FxKind>(['heal', 'smoke', 'teleport']);

export interface FxContext {
  /** Prefixo único dos ids de gradiente (um por efeito na tela). */
  uid: string;
  /** Zoom no momento do lançamento (tamanhos mínimos legíveis). */
  scale: number;
  /** Tamanho do quadrado da grade (px do mapa). */
  grid: number;
  random: () => number;
}

/** Filtro de brilho definido na camada (fx-layer). */
export const FX_GLOW = 'url(#dt-fx-glow)';

const CENTER = 'transform-box:fill-box;transform-origin:center;';
const LEFT = 'transform-box:fill-box;transform-origin:0% 50%;';
const BOTTOM = 'transform-box:fill-box;transform-origin:50% 100%;';
const WHITE = '#ffffff';

// --- API ---------------------------------------------------------------------

/** O efeito é radial (centro + raio) ou vai da origem até o alvo? */
export function isRadialFx(kind: FxKind): boolean {
  return FX_KINDS.find((k) => k.id === kind)?.radial ?? false;
}

/** Monta o desenho de um efeito lançado de `from` até `to`. */
export function buildFx(kind: FxKind, color: string, from: Point, to: Point, ctx: FxContext): FxDrawing {
  const { length, angle } = fxFrame(from, to);
  const b = new FxBuilder(ctx, color);
  const L = Math.max(length, b.ui(12));
  const radial = isRadialFx(kind);
  const built = BUILDERS[kind](b, L);
  return {
    transform: `translate(${r2(from.x)} ${r2(from.y)})` + (radial ? '' : ` rotate(${r2(angle)})`),
    gradients: b.gradients,
    parts: built.parts,
    // Nunca antes de a última parte terminar (senão ela seria cortada ao remover o efeito)
    duration: Math.ceil(Math.max(built.duration, lastEnd(built.parts))),
    upright: UPRIGHT_FX.has(kind),
  };
}

/** CSS final de uma parte. `offset` adianta a animação (ms) e `paused` congela — usados para capturas. */
export function fxCss(part: FxPart, offset = 0, paused = false): string {
  let css = part.css ?? '';
  const a = part.anim;
  if (a) {
    css += `animation:${a.name} ${a.duration}ms ${a.easing ?? 'ease-out'} ${(a.delay ?? 0) - offset}ms ${a.iterations ?? 1} both;`;
    if (paused) css += 'animation-play-state:paused;';
  }
  return css;
}

/** Comprimento e ângulo (graus) do arraste. */
export function fxFrame(from: Point, to: Point): { length: number; angle: number } {
  return {
    length: Math.hypot(to.x - from.x, to.y - from.y),
    angle: (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI,
  };
}

/** Gerador pseudoaleatório semeado (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mistura duas cores #rrggbb (t = 0 → a; t = 1 → b). */
export function mixColor(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  return '#' + pa.map((c, i) => Math.round(c + (pb[i] - c) * t).toString(16).padStart(2, '0')).join('');
}

/**
 * Raio natural (deslocamento do ponto médio): cada segmento é dividido ao meio e o meio
 * desviado na perpendicular; o desvio cai pela metade a cada nível. Pontas fixas.
 */
export function displaceLine(a: Point, b: Point, roughness: number, levels: number, random: () => number): Point[] {
  let points = [a, b];
  let amount = roughness;
  for (let level = 0; level < levels; level++) {
    const next: Point[] = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const p = points[i - 1];
      const q = points[i];
      const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      const off = (random() * 2 - 1) * amount;
      next.push({ x: (p.x + q.x) / 2 + (-(q.y - p.y) / len) * off, y: (p.y + q.y) / 2 + ((q.x - p.x) / len) * off }, q);
    }
    points = next;
    amount /= 2;
  }
  return points;
}

/** Pontos como texto para o atributo `points` do SVG. */
export function toPointsAttr(points: Point[]): string {
  return points.map((p) => `${r2(p.x)},${r2(p.y)}`).join(' ');
}

// --- Construção --------------------------------------------------------------

/** Ajudante de construção: cor, gradientes, sorteios e tamanhos legíveis. */
class FxBuilder {
  readonly gradients: FxGradient[] = [];
  /** Tons derivados da cor do elemento. */
  readonly light: string;
  readonly dark: string;

  constructor(
    readonly ctx: FxContext,
    readonly color: string,
  ) {
    this.light = mixColor(color, WHITE, 0.55);
    this.dark = mixColor(color, '#12141c', 0.72);
  }

  /** Px de tela → px do mapa. */
  ui(px: number): number {
    return px / this.ctx.scale;
  }

  /** Proporcional a `size`, mas nunca menor que `minPx` na tela. */
  thick(size: number, ratio: number, minPx: number): number {
    return Math.max(size * ratio, this.ui(minPx));
  }

  rnd(min: number, max: number): number {
    return min + (max - min) * this.ctx.random();
  }

  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.ctx.random() * list.length)];
  }

  /** Ponto uniforme dentro de um círculo de raio `radius`. */
  inside(radius: number): Point {
    const a = this.rnd(0, Math.PI * 2);
    const d = Math.sqrt(this.ctx.random()) * radius;
    return { x: Math.cos(a) * d, y: Math.sin(a) * d };
  }

  /** Registra um gradiente e devolve o `url(#…)` para usar em fill/stroke. */
  gradient(type: 'radial' | 'linear', stops: FxStop[], vertical = false): string {
    const id = `${this.ctx.uid}-g${this.gradients.length}`;
    this.gradients.push({ id, type, stops, vertical });
    return `url(#${id})`;
  }

  /** Gradiente "brasa": branco no centro → tom claro → cor → transparente. */
  hotGradient(): string {
    return this.gradient('radial', [
      { offset: 0, color: WHITE },
      { offset: 0.25, color: this.light },
      { offset: 0.55, color: this.color, opacity: 0.9 },
      { offset: 1, color: this.color, opacity: 0 },
    ]);
  }

  /**
   * Partículas que saem de (x, y) em direções sorteadas.
   * `streak` = riscos alinhados à direção (faíscas); senão, pontos.
   */
  particles(o: {
    x?: number;
    y?: number;
    count: number;
    dist: [number, number];
    angle?: [number, number];
    size: [number, number];
    colors: string[];
    duration: [number, number];
    delay?: [number, number];
    streak?: boolean;
    s1?: number;
    glow?: boolean;
  }): FxPart[] {
    const x = o.x ?? 0;
    const y = o.y ?? 0;
    return Array.from({ length: o.count }, (): FxPart => {
      const a = (this.rnd(...(o.angle ?? [0, 360])) * Math.PI) / 180;
      const d = this.rnd(...o.dist);
      const size = this.rnd(...o.size);
      const color = this.pick(o.colors);
      const anim = { name: 'fx-move', duration: this.rnd(...o.duration), delay: this.rnd(...(o.delay ?? [0, 0])), easing: 'cubic-bezier(.15,.7,.3,1)' };
      const css = CENTER + move(Math.cos(a) * d, Math.sin(a) * d, o.s1 ?? 0.3);
      const filter: Record<string, string> = o.glow ? { filter: FX_GLOW } : {};
      if (o.streak) {
        const len = size * 5;
        return {
          tag: 'line',
          attrs: { x1: r2(x), y1: r2(y), x2: r2(x + Math.cos(a) * len), y2: r2(y + Math.sin(a) * len), stroke: color, 'stroke-width': r2(size), 'stroke-linecap': 'round', ...filter },
          css,
          anim,
        };
      }
      return { tag: 'circle', attrs: { cx: r2(x), cy: r2(y), r: r2(size), fill: color, ...filter }, css, anim };
    });
  }
}

type Built = { parts: FxPart[]; duration: number };

const BUILDERS: Record<FxKind, (b: FxBuilder, L: number) => Built> = {
  slash,
  claw,
  thrust,
  impact,
  arrow,
  projectile,
  fireball,
  lightning,
  beam,
  cone,
  explosion,
  wave,
  smoke,
  meteor,
  eruption,
  vortex,
  heal,
  shield,
  rune,
  teleport,
};

// --- Golpes ------------------------------------------------------------------

/** Lâmina em forma de meia-lua de (0,0) a (L,0); `h1`/`h2` = bojo externo/interno. */
function crescent(L: number, h1: number, h2: number): string {
  return `M 0 0 Q ${r2(L / 2)} ${r2(-2 * h1)} ${r2(L)} 0 Q ${r2(L / 2)} ${r2(-2 * h2)} 0 0 Z`;
}

/** Degradê da lâmina: rastro transparente → cor → ponta branca. */
function bladeGradient(b: FxBuilder): string {
  return b.gradient('linear', [
    { offset: 0, color: b.color, opacity: 0 },
    { offset: 0.5, color: b.color, opacity: 0.85 },
    { offset: 0.85, color: b.light },
    { offset: 1, color: WHITE },
  ]);
}

function slash(b: FxBuilder, L: number): Built {
  const blade = bladeGradient(b);
  return {
    duration: 800,
    parts: [
      // Rastro largo e translúcido
      { tag: 'path', attrs: { d: crescent(L, L * 0.36, L * 0.14), fill: b.color, 'fill-opacity': 0.3, filter: FX_GLOW }, css: LEFT, anim: { name: 'fx-swipe', duration: 650, delay: 20 } },
      // Lâmina principal
      { tag: 'path', attrs: { d: crescent(L, L * 0.3, L * 0.17), fill: blade, filter: FX_GLOW }, css: LEFT, anim: { name: 'fx-swipe', duration: 520 } },
      // Fio branco da lâmina
      { tag: 'path', attrs: { d: `M 0 0 Q ${r2(L / 2)} ${r2(-L * 0.6)} ${r2(L)} 0`, fill: 'none', stroke: WHITE, 'stroke-width': r2(b.thick(L, 0.012, 1.5)), 'stroke-linecap': 'round', pathLength: 1, 'stroke-dasharray': 1 }, anim: { name: 'fx-draw', duration: 380 } },
      ...b.particles({ x: L, count: 8, angle: [-80, 40], dist: [L * 0.08, L * 0.25], size: [b.ui(1.2), b.thick(L, 0.01, 2.5)], colors: [b.light, WHITE], duration: [300, 520], delay: [110, 200], streak: true }),
    ],
  };
}

function claw(b: FxBuilder, L: number): Built {
  const blade = bladeGradient(b);
  const parts: FxPart[] = [];
  [-1, 0, 1].forEach((k, i) => {
    const len = L * b.rnd(0.88, 1);
    const delay = i * 55;
    parts.push({
      tag: 'g',
      attrs: { transform: `translate(${r2(L * 0.04 * i)} ${r2(k * L * 0.11)})` },
      children: [
        { tag: 'path', attrs: { d: crescent(len, len * 0.1, len * 0.045), fill: blade, filter: FX_GLOW }, css: LEFT, anim: { name: 'fx-swipe', duration: 520, delay } },
        { tag: 'path', attrs: { d: `M 0 0 Q ${r2(len / 2)} ${r2(-len * 0.2)} ${r2(len)} 0`, fill: 'none', stroke: WHITE, 'stroke-width': r2(b.thick(L, 0.007, 1.2)), 'stroke-linecap': 'round', pathLength: 1, 'stroke-dasharray': 1 }, anim: { name: 'fx-draw', duration: 360, delay } },
        ...b.particles({ x: len, count: 3, angle: [-60, 60], dist: [L * 0.05, L * 0.14], size: [b.ui(1.2), b.thick(L, 0.008, 2)], colors: [b.color, b.light], duration: [300, 450], delay: [delay + 120, delay + 180] }),
      ],
    });
  });
  return { duration: 850, parts };
}

function thrust(b: FxBuilder, L: number): Built {
  const w = b.thick(L, 0.045, 4);
  const tip = b.thick(L, 0.1, 10);
  const spike = b.gradient('linear', [
    { offset: 0, color: b.color, opacity: 0 },
    { offset: 0.5, color: b.color, opacity: 0.8 },
    { offset: 0.9, color: b.light },
    { offset: 1, color: WHITE },
  ]);
  return {
    duration: 750,
    parts: [
      // Linhas de velocidade
      ...Array.from({ length: 5 }, (): FxPart => {
        const y = b.rnd(-w * 3, w * 3);
        const x1 = b.rnd(0, L * 0.2);
        return { tag: 'line', attrs: { x1: r2(x1), y1: r2(y), x2: r2(x1 + L * b.rnd(0.35, 0.6)), y2: r2(y), stroke: b.light, 'stroke-opacity': 0.7, 'stroke-width': r2(b.ui(1.2)), pathLength: 1, 'stroke-dasharray': 1 }, anim: { name: 'fx-draw', duration: 320, delay: b.rnd(0, 80) } };
      }),
      // Ponta da estocada
      { tag: 'path', attrs: { d: `M 0 ${r2(-w)} L ${r2(L * 0.82)} ${r2(-w * 0.35)} L ${r2(L)} 0 L ${r2(L * 0.82)} ${r2(w * 0.35)} L 0 ${r2(w)} Z`, fill: spike, filter: FX_GLOW }, css: LEFT, anim: { name: 'fx-swipe', duration: 430 } },
      // Impacto na ponta
      { tag: 'circle', attrs: { cx: r2(L), cy: 0, r: r2(tip), fill: 'none', stroke: b.color, 'stroke-width': r2(b.ui(2)), filter: FX_GLOW }, css: CENTER + '--s0:0.2;', anim: { name: 'fx-grow', duration: 420, delay: 90 } },
      { tag: 'circle', attrs: { cx: r2(L), cy: 0, r: r2(tip * 0.55), fill: WHITE }, css: CENTER, anim: { name: 'fx-flash', duration: 260, delay: 80 } },
      ...b.particles({ x: L, count: 7, angle: [-55, 55], dist: [L * 0.05, L * 0.16], size: [b.ui(1.2), b.thick(L, 0.01, 2.5)], colors: [b.light, WHITE], duration: [300, 480], delay: [90, 140], streak: true }),
    ],
  };
}

function impact(b: FxBuilder, R: number): Built {
  const star: Point[] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2 + b.rnd(-0.05, 0.05);
    const r = i % 2 ? R * b.rnd(0.32, 0.45) : R * b.rnd(0.7, 1.1);
    star.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  const cracks = Array.from({ length: 6 }, (): FxPart => {
    const a = b.rnd(0, Math.PI * 2);
    const len = R * b.rnd(0.5, 0.95);
    const pts = displaceLine({ x: 0, y: 0 }, { x: Math.cos(a) * len, y: Math.sin(a) * len }, len * 0.15, 3, b.ctx.random);
    return { tag: 'polyline', attrs: { points: toPointsAttr(pts), fill: 'none', stroke: b.dark, 'stroke-width': r2(b.thick(R, 0.025, 1.5)), 'stroke-linejoin': 'round', pathLength: 1, 'stroke-dasharray': 1 }, anim: { name: 'fx-draw', duration: 900 } };
  });
  return {
    duration: 950,
    parts: [
      ...cracks,
      { tag: 'polygon', attrs: { points: toPointsAttr(star), fill: b.hotGradient(), filter: FX_GLOW }, css: CENTER + '--s0:0.15;', anim: { name: 'fx-blast', duration: 600, easing: 'cubic-bezier(.1,.8,.3,1)' } },
      { tag: 'circle', attrs: { r: r2(R * 1.15), fill: 'none', stroke: b.light, 'stroke-width': r2(b.thick(R, 0.04, 2)) }, css: CENTER + '--s0:0.3;', anim: { name: 'fx-grow', duration: 520 } },
      { tag: 'circle', attrs: { r: r2(R * 0.32), fill: WHITE }, css: CENTER + '--s0:0.3;', anim: { name: 'fx-flash', duration: 170 } },
      ...b.particles({ count: 14, dist: [R * 0.7, R * 1.4], size: [b.thick(R, 0.02, 1.5), b.thick(R, 0.05, 3)], colors: [b.light, b.color, WHITE], duration: [450, 750] }),
    ],
  };
}

// --- Disparos ----------------------------------------------------------------

/** Tempo de voo de um projétil: cresce com a distância (em quadrados), com limite. */
function travelTime(b: FxBuilder, L: number, base: number, perSquare: number): number {
  return base + Math.min(L / b.ctx.grid, 30) * perSquare;
}

function arrow(b: FxBuilder, L: number): Built {
  const a = Math.max(b.ctx.grid * 0.75, b.ui(26));
  const shaft = Math.max(a * 0.05, b.ui(1.5));
  const hw = a * 0.11;
  const head = hw * 2.6;
  const t = travelTime(b, L, 320, 14);
  /** Flecha com a ponta em (0,0), apontando para +x. */
  const body = (): FxPart[] => [
    { tag: 'line', attrs: { x1: r2(-a), y1: 0, x2: r2(-head), y2: 0, stroke: '#e3d8bd', 'stroke-width': r2(shaft), 'stroke-linecap': 'round' } },
    { tag: 'polygon', attrs: { points: toPointsAttr([{ x: -head, y: -hw }, { x: 0, y: 0 }, { x: -head, y: hw }]), fill: b.light, stroke: b.color, 'stroke-width': r2(shaft * 0.5) } },
    { tag: 'polygon', attrs: { points: toPointsAttr([{ x: -a, y: 0 }, { x: -a * 0.78, y: 0 }, { x: -a * 0.98, y: -hw * 1.3 }]), fill: b.color } },
    { tag: 'polygon', attrs: { points: toPointsAttr([{ x: -a, y: 0 }, { x: -a * 0.78, y: 0 }, { x: -a * 0.98, y: hw * 1.3 }]), fill: b.color } },
  ];
  return {
    duration: t + 650,
    parts: [
      {
        tag: 'g',
        attrs: {},
        css: `--dx:${r2(L)}px;`,
        anim: { name: 'fx-travel', duration: t, easing: 'cubic-bezier(.3,.1,.8,1)' },
        children: [
          // Rastro
          { tag: 'line', attrs: { x1: r2(-a * 3.5), y1: 0, x2: r2(-a * 0.9), y2: 0, stroke: b.color, 'stroke-opacity': 0.55, 'stroke-width': r2(shaft * 1.6), 'stroke-linecap': 'round', filter: FX_GLOW } },
          ...body(),
        ],
      },
      // Flecha cravada no alvo
      { tag: 'g', attrs: { transform: `translate(${r2(L)} 0)` }, anim: { name: 'fx-hold', duration: 600, delay: t * 0.9 }, children: body() },
      { tag: 'circle', attrs: { cx: r2(L), cy: 0, r: r2(hw * 3), fill: 'none', stroke: b.light, 'stroke-width': r2(b.ui(1.5)) }, css: CENTER + '--s0:0.2;', anim: { name: 'fx-grow', duration: 380, delay: t * 0.88 } },
      ...b.particles({ x: L, count: 6, angle: [130, 230], dist: [hw * 2, hw * 6], size: [b.ui(1), b.ui(2)], colors: ['#e3d8bd', b.light], duration: [300, 450], delay: [t * 0.88, t * 0.9] }),
    ],
  };
}

/** Clarão + anel + faíscas num ponto (chegada de projéteis). */
function burstAt(b: FxBuilder, x: number, size: number, delay: number): FxPart[] {
  return [
    { tag: 'circle', attrs: { cx: r2(x), cy: 0, r: r2(size * 1.8), fill: b.hotGradient(), filter: FX_GLOW }, css: CENTER + '--s0:0.2;', anim: { name: 'fx-grow', duration: 450, delay } },
    { tag: 'circle', attrs: { cx: r2(x), cy: 0, r: r2(size * 2.6), fill: 'none', stroke: b.light, 'stroke-width': r2(b.ui(1.8)) }, css: CENTER + '--s0:0.25;', anim: { name: 'fx-grow', duration: 480, delay } },
    ...b.particles({ x, count: 10, dist: [size * 1.5, size * 4], size: [b.ui(1.2), b.ui(2.5)], colors: [b.light, WHITE, b.color], duration: [350, 600], delay: [delay, delay + 40], streak: true }),
  ];
}

function projectile(b: FxBuilder, L: number): Built {
  const r = b.thick(L, 0.028, 7);
  const t = travelTime(b, L, 380, 12);
  return {
    duration: t + 650,
    parts: [
      // Rastro de faíscas que ficam para trás
      ...Array.from({ length: 12 }, (_, i): FxPart => {
        const x = (L * i) / 12;
        return {
          tag: 'circle',
          attrs: { cx: r2(x), cy: r2(b.rnd(-r * 0.4, r * 0.4)), r: r2(r * b.rnd(0.35, 0.7)), fill: b.pick([b.light, b.color]) },
          css: CENTER + move(b.rnd(-r * 2.5, -r * 0.5), b.rnd(-r * 1.5, r * 1.5), 0.2),
          anim: { name: 'fx-move', duration: b.rnd(380, 560), delay: (t * i) / 12 },
        };
      }),
      {
        tag: 'g',
        attrs: {},
        css: `--dx:${r2(L)}px;`,
        anim: { name: 'fx-travel', duration: t, easing: 'cubic-bezier(.4,0,.9,1)' },
        children: [
          { tag: 'circle', attrs: { r: r2(r * 3), fill: b.hotGradient() } },
          { tag: 'circle', attrs: { r: r2(r), fill: WHITE, filter: FX_GLOW } },
        ],
      },
      ...burstAt(b, L, r * 1.4, t * 0.88),
    ],
  };
}

function fireball(b: FxBuilder, L: number): Built {
  const r = b.thick(L, 0.035, 9);
  const t = travelTime(b, L, 420, 14);
  const tail = b.gradient('linear', [
    { offset: 0, color: b.color, opacity: 0 },
    { offset: 0.6, color: b.color, opacity: 0.85 },
    { offset: 1, color: b.light },
  ]);
  const smokeTone = mixColor(b.color, '#2a2a2e', 0.8);
  const R = Math.max(L * 0.22, b.ctx.grid * 1.1);
  const blast = explosion(b, R);
  return {
    duration: t + blast.duration,
    parts: [
      // Fumaça e brasas deixadas no caminho
      ...Array.from({ length: 8 }, (_, i): FxPart => {
        const x = (L * (i + 0.5)) / 9;
        return {
          tag: 'circle',
          attrs: { cx: r2(x), cy: r2(b.rnd(-r * 0.5, r * 0.5)), r: r2(r * b.rnd(0.8, 1.3)), fill: smokeTone, 'fill-opacity': 0.45 },
          css: CENTER + move(b.rnd(-r, r * 0.3), b.rnd(-r * 1.5, -r * 0.2), 2),
          anim: { name: 'fx-smoke', duration: b.rnd(600, 900), delay: (t * (i + 0.5)) / 9 },
        };
      }),
      ...Array.from({ length: 14 }, (_, i): FxPart => {
        const x = (L * i) / 14;
        return {
          tag: 'circle',
          attrs: { cx: r2(x), cy: r2(b.rnd(-r * 0.6, r * 0.6)), r: r2(r * b.rnd(0.15, 0.35)), fill: b.pick([b.light, WHITE, b.color]) },
          css: CENTER + move(b.rnd(-r * 3, 0), b.rnd(-r * 2, r * 2), 0.1),
          anim: { name: 'fx-move', duration: b.rnd(400, 650), delay: (t * i) / 14 },
        };
      }),
      {
        tag: 'g',
        attrs: {},
        css: `--dx:${r2(L)}px;`,
        anim: { name: 'fx-travel', duration: t, easing: 'cubic-bezier(.35,0,.85,1)' },
        children: [
          // Cauda de fogo tremulando
          {
            tag: 'g',
            attrs: {},
            css: CENTER + '--sy:0.7;',
            anim: { name: 'fx-pulse', duration: 90, iterations: Math.ceil(t / 90), easing: 'ease-in-out' },
            children: [
              { tag: 'path', attrs: { d: `M ${r2(r)} 0 Q 0 ${r2(-r * 1.7)} ${r2(-r * 5.5)} 0 Q 0 ${r2(r * 1.7)} ${r2(r)} 0 Z`, fill: tail, filter: FX_GLOW } },
            ],
          },
          { tag: 'circle', attrs: { r: r2(r * 1.7), fill: b.hotGradient(), filter: FX_GLOW } },
          { tag: 'circle', attrs: { r: r2(r * 0.6), fill: WHITE } },
        ],
      },
      { tag: 'g', attrs: { transform: `translate(${r2(L)} 0)` }, children: delayParts(blast.parts, t * 0.88) },
    ],
  };
}

function lightning(b: FxBuilder, L: number): Built {
  const w = b.thick(L, 0.007, 2.2);
  /** Um raio completo (tronco + ramificações) que pisca. */
  const bolt = (delay: number): FxPart => {
    const main = displaceLine({ x: 0, y: 0 }, { x: L, y: 0 }, L * 0.16, 6, b.ctx.random);
    const branches = Array.from({ length: 3 }, () => {
      const start = main[Math.floor(b.rnd(0.2, 0.75) * main.length)];
      const a = (b.pick([-1, 1]) * b.rnd(20, 50) * Math.PI) / 180;
      const len = L * b.rnd(0.14, 0.3);
      return displaceLine(start, { x: start.x + Math.cos(a) * len, y: start.y + Math.sin(a) * len }, len * 0.2, 4, b.ctx.random);
    });
    const strokes = (pts: Point[], k: number): FxPart[] => [
      { tag: 'polyline', attrs: { points: toPointsAttr(pts), fill: 'none', stroke: b.color, 'stroke-opacity': 0.35, 'stroke-width': r2(w * 4 * k), 'stroke-linejoin': 'round', 'stroke-linecap': 'round', filter: FX_GLOW } },
      { tag: 'polyline', attrs: { points: toPointsAttr(pts), fill: 'none', stroke: b.light, 'stroke-width': r2(w * k), 'stroke-linejoin': 'round', 'stroke-linecap': 'round' } },
      { tag: 'polyline', attrs: { points: toPointsAttr(pts), fill: 'none', stroke: WHITE, 'stroke-width': r2(w * 0.45 * k), 'stroke-linejoin': 'round', 'stroke-linecap': 'round' } },
    ];
    return {
      tag: 'g',
      attrs: {},
      anim: { name: 'fx-flicker', duration: 700, delay, easing: 'linear' },
      children: [...strokes(main, 1), ...branches.flatMap((p) => strokes(p, 0.55))],
    };
  };
  const flash = b.thick(L, 0.07, 12);
  return {
    duration: 850,
    parts: [
      // Dois raios alternando = tremulação natural
      bolt(0),
      bolt(70),
      { tag: 'circle', attrs: { cx: r2(L), cy: 0, r: r2(flash * 2.2), fill: b.hotGradient() }, css: CENTER + '--s0:0.3;', anim: { name: 'fx-grow', duration: 550 } },
      { tag: 'circle', attrs: { cx: r2(L), cy: 0, r: r2(flash), fill: WHITE, filter: FX_GLOW }, css: CENTER, anim: { name: 'fx-flash', duration: 320 } },
      { tag: 'circle', attrs: { r: r2(flash * 0.6), fill: WHITE, filter: FX_GLOW }, css: CENTER, anim: { name: 'fx-flash', duration: 260 } },
      ...b.particles({ x: L, count: 12, dist: [L * 0.04, L * 0.14], size: [b.ui(1), b.ui(2)], colors: [WHITE, b.light], duration: [250, 450], streak: true }),
    ],
  };
}

function beam(b: FxBuilder, L: number): Built {
  const bw = b.thick(L, 0.03, 7);
  const flare = b.hotGradient();
  return {
    duration: 1000,
    parts: [
      {
        tag: 'g',
        attrs: {},
        css: LEFT,
        anim: { name: 'fx-beam', duration: 900 },
        children: [
          {
            tag: 'g',
            attrs: {},
            css: CENTER + '--sy:0.65;',
            anim: { name: 'fx-pulse', duration: 110, iterations: 8, easing: 'ease-in-out' },
            children: [
              { tag: 'rect', attrs: { x: 0, y: r2(-bw * 1.3), width: r2(L), height: r2(bw * 2.6), rx: r2(bw * 1.3), fill: b.color, 'fill-opacity': 0.3, filter: FX_GLOW } },
              { tag: 'rect', attrs: { x: 0, y: r2(-bw / 2), width: r2(L), height: r2(bw), rx: r2(bw / 2), fill: b.light, filter: FX_GLOW } },
              { tag: 'rect', attrs: { x: 0, y: r2(-bw * 0.18), width: r2(L), height: r2(bw * 0.36), rx: r2(bw * 0.18), fill: WHITE } },
            ],
          },
        ],
      },
      { tag: 'circle', attrs: { r: r2(bw * 1.6), fill: flare }, css: CENTER, anim: { name: 'fx-hold', duration: 900 } },
      { tag: 'circle', attrs: { cx: r2(L), cy: 0, r: r2(bw * 2.4), fill: flare }, css: CENTER, anim: { name: 'fx-hold', duration: 820, delay: 120 } },
      ...b.particles({ x: L, count: 16, angle: [110, 250], dist: [bw * 2, bw * 7], size: [b.ui(1), b.ui(2.2)], colors: [WHITE, b.light], duration: [300, 450], delay: [80, 650], streak: true }),
    ],
  };
}

function cone(b: FxBuilder, L: number): Built {
  const fill = b.gradient('linear', [
    { offset: 0, color: WHITE, opacity: 0.95 },
    { offset: 0.25, color: b.light, opacity: 0.9 },
    { offset: 0.6, color: b.color, opacity: 0.65 },
    { offset: 1, color: b.color, opacity: 0 },
  ]);
  const conePath = (len: number, h: number) => `M 0 0 L ${r2(len)} ${r2(-h)} Q ${r2(len * 1.12)} 0 ${r2(len)} ${r2(h)} Z`;
  return {
    duration: 1150,
    parts: [
      { tag: 'path', attrs: { d: conePath(L, L * 0.36), fill, filter: FX_GLOW }, css: LEFT, anim: { name: 'fx-cone', duration: 900 } },
      { tag: 'path', attrs: { d: conePath(L * 0.75, L * 0.16), fill }, css: LEFT, anim: { name: 'fx-cone', duration: 700, delay: 40 } },
      // Jorro de partículas que se espalham dentro do cone
      ...Array.from({ length: 30 }, (): FxPart => {
        const a = (b.rnd(-19, 19) * Math.PI) / 180;
        const d = L * b.rnd(0.55, 1.05);
        return {
          tag: 'circle',
          attrs: { cx: r2(b.rnd(0, L * 0.08)), cy: 0, r: r2(b.thick(L, b.rnd(0.01, 0.025), 1.5)), fill: b.pick([b.light, b.color, WHITE]) },
          css: CENTER + move(Math.cos(a) * d, Math.sin(a) * d, b.rnd(1.2, 2.2)),
          anim: { name: 'fx-move', duration: b.rnd(450, 750), delay: b.rnd(0, 320) },
        };
      }),
    ],
  };
}

// --- Área --------------------------------------------------------------------

function explosion(b: FxBuilder, R: number): Built {
  const smokeTone = mixColor(b.color, '#22242c', 0.78);
  const smokeFill = b.gradient('radial', [
    { offset: 0, color: smokeTone, opacity: 0.75 },
    { offset: 0.6, color: smokeTone, opacity: 0.45 },
    { offset: 1, color: smokeTone, opacity: 0 },
  ]);
  const fire = b.gradient('radial', [
    { offset: 0, color: WHITE },
    { offset: 0.22, color: b.light },
    { offset: 0.5, color: b.color, opacity: 0.95 },
    { offset: 0.8, color: b.color, opacity: 0.5 },
    { offset: 1, color: b.color, opacity: 0 },
  ]);
  return {
    duration: 1800,
    parts: [
      // Fumaça (atrás do fogo), subindo devagar
      ...Array.from({ length: 8 }, (): FxPart => {
        const p = b.inside(R * 0.5);
        return {
          tag: 'circle',
          attrs: { cx: r2(p.x), cy: r2(p.y), r: r2(R * b.rnd(0.35, 0.55)), fill: smokeFill },
          css: CENTER + move(b.rnd(-R * 0.3, R * 0.3), b.rnd(-R * 0.5, -R * 0.1), 1.6),
          anim: { name: 'fx-smoke', duration: b.rnd(1200, 1600), delay: b.rnd(150, 350) },
        };
      }),
      // Onda de choque
      { tag: 'circle', attrs: { r: r2(R * 1.4), fill: 'none', stroke: b.light, 'stroke-width': r2(b.thick(R, 0.025, 1.5)) }, css: CENTER + '--s0:0.2;', anim: { name: 'fx-grow', duration: 450, easing: 'cubic-bezier(.1,.8,.3,1)' } },
      // Bola de fogo principal + lóbulos irregulares
      { tag: 'circle', attrs: { r: r2(R), fill: fire, filter: FX_GLOW }, css: CENTER + '--s0:0.12;', anim: { name: 'fx-blast', duration: 950, easing: 'cubic-bezier(.15,.85,.3,1)' } },
      ...Array.from({ length: 5 }, (): FxPart => {
        const p = b.inside(R * 0.45);
        return { tag: 'circle', attrs: { cx: r2(p.x), cy: r2(p.y), r: r2(R * b.rnd(0.35, 0.55)), fill: fire }, css: CENTER + '--s0:0.15;', anim: { name: 'fx-blast', duration: b.rnd(700, 900), delay: b.rnd(20, 140), easing: 'cubic-bezier(.15,.85,.3,1)' } };
      }),
      { tag: 'circle', attrs: { r: r2(R * 0.7), fill: WHITE }, css: CENTER + '--s0:0.3;', anim: { name: 'fx-flash', duration: 220 } },
      // Destroços e faíscas
      ...b.particles({ count: 10, dist: [R * 0.9, R * 1.7], size: [b.thick(R, 0.015, 1.5), b.thick(R, 0.045, 3)], colors: [b.light, b.color, WHITE], duration: [500, 850] }),
      ...b.particles({ count: 10, dist: [R * 0.9, R * 1.6], size: [b.ui(1), b.thick(R, 0.015, 2)], colors: [b.light, WHITE], duration: [400, 650], streak: true }),
    ],
  };
}

function wave(b: FxBuilder, R: number): Built {
  const rim = b.gradient('radial', [
    { offset: 0, color: b.color, opacity: 0 },
    { offset: 0.7, color: b.color, opacity: 0 },
    { offset: 0.92, color: b.color, opacity: 0.45 },
    { offset: 1, color: b.color, opacity: 0 },
  ]);
  const width = b.thick(R, 0.065, 3);
  return {
    duration: 1250,
    parts: [
      { tag: 'circle', attrs: { r: r2(R), fill: rim }, css: CENTER + '--s0:0.05;', anim: { name: 'fx-blast', duration: 850, easing: 'cubic-bezier(.1,.7,.3,1)' } },
      ...[1, 0.6, 0.35].map((k, i): FxPart => ({
        tag: 'circle',
        attrs: { r: r2(R), fill: 'none', stroke: i ? b.light : b.color, 'stroke-width': r2(width * k), ...(i ? {} : { filter: FX_GLOW }) },
        css: CENTER + '--s0:0.05;',
        anim: { name: 'fx-grow', duration: 850, delay: i * 110, easing: 'cubic-bezier(.1,.7,.3,1)' },
      })),
      // Poeira empurrada para fora
      ...Array.from({ length: 18 }, (): FxPart => {
        const a = b.rnd(0, Math.PI * 2);
        return {
          tag: 'circle',
          attrs: { cx: r2(Math.cos(a) * R * 0.25), cy: r2(Math.sin(a) * R * 0.25), r: r2(b.thick(R, b.rnd(0.012, 0.025), 1.5)), fill: b.light },
          css: CENTER + move(Math.cos(a) * R * 0.8, Math.sin(a) * R * 0.8, 0.4),
          anim: { name: 'fx-move', duration: b.rnd(700, 900), easing: 'cubic-bezier(.1,.7,.3,1)' },
        };
      }),
    ],
  };
}

function smoke(b: FxBuilder, R: number): Built {
  const tone = mixColor(b.color, '#9aa3b5', 0.55);
  const puff = b.gradient('radial', [
    { offset: 0, color: tone, opacity: 0.8 },
    { offset: 0.55, color: tone, opacity: 0.55 },
    { offset: 1, color: tone, opacity: 0 },
  ]);
  return {
    duration: 2700,
    parts: Array.from({ length: 16 }, (): FxPart => {
      const p = b.inside(R * 0.75);
      return {
        tag: 'circle',
        attrs: { cx: r2(p.x), cy: r2(p.y), r: r2(R * b.rnd(0.28, 0.48)), fill: puff },
        css: CENTER + move(b.rnd(-R * 0.2, R * 0.2), b.rnd(-R * 0.25, R * 0.05), b.rnd(1.3, 1.8)),
        anim: { name: 'fx-smoke', duration: b.rnd(1700, 2300), delay: b.rnd(0, 350), easing: 'ease-out' },
      };
    }),
  };
}

function meteor(b: FxBuilder, R: number): Built {
  const parts: FxPart[] = [
    // Área atingida
    { tag: 'circle', attrs: { r: r2(R), fill: b.color, 'fill-opacity': 0.07, stroke: b.color, 'stroke-opacity': 0.6, 'stroke-width': r2(b.ui(1.5)), 'stroke-dasharray': `${r2(b.ui(6))} ${r2(b.ui(5))}` }, anim: { name: 'fx-hold', duration: 1900 } },
  ];
  const fall = 380;
  let last = 0;
  for (let i = 0; i < 7; i++) {
    const p = b.inside(R * 0.85);
    const delay = i * 110 + b.rnd(0, 80);
    last = delay;
    const size = b.thick(R, 0.035, 3);
    const tail = R * 0.35;
    parts.push(
      {
        tag: 'g',
        attrs: { transform: `translate(${r2(p.x)} ${r2(p.y)})` },
        children: [
          {
            tag: 'g',
            attrs: {},
            css: `--dx:${r2(-R * 0.55)}px;--dy:${r2(-R * 1.1)}px;`,
            anim: { name: 'fx-fall', duration: fall, delay, easing: 'ease-in' },
            children: [
              { tag: 'line', attrs: { x1: 0, y1: 0, x2: r2(-tail * 0.45), y2: r2(-tail * 0.89), stroke: b.light, 'stroke-opacity': 0.8, 'stroke-width': r2(size * 0.9), 'stroke-linecap': 'round', filter: FX_GLOW } },
              { tag: 'circle', attrs: { r: r2(size), fill: WHITE, filter: FX_GLOW } },
            ],
          },
          { tag: 'circle', attrs: { r: r2(R * 0.16), fill: b.hotGradient() }, css: CENTER + '--s0:0.2;', anim: { name: 'fx-grow', duration: 420, delay: delay + fall * 0.9 } },
          { tag: 'circle', attrs: { r: r2(R * 0.24), fill: 'none', stroke: b.light, 'stroke-width': r2(b.ui(1.5)) }, css: CENTER + '--s0:0.2;', anim: { name: 'fx-grow', duration: 450, delay: delay + fall * 0.9 } },
          ...b.particles({ count: 5, dist: [R * 0.1, R * 0.25], size: [b.ui(1), b.ui(2)], colors: [b.light, WHITE], duration: [300, 450], delay: [delay + fall * 0.9, delay + fall] }),
        ],
      },
    );
  }
  return { duration: last + fall + 600, parts };
}

/**
 * Erupção: uma fileira de explosões de estacas ao longo do arraste (sem linha ligando os pontos).
 * Cada ponto: cratera escura no chão, brilho, anel de impacto, 4–6 estacas saindo do centro
 * (~1 quadrado) e destroços.
 */
function eruption(b: FxBuilder, L: number): Built {
  const grid = b.ctx.grid;
  const step = 80;
  const n = Math.min(12, Math.max(2, Math.round(L / (grid * 1.15))));
  const spikeFill = b.gradient('linear', [{ offset: 0, color: b.color }, { offset: 0.55, color: b.light }, { offset: 1, color: WHITE }]);
  const crater = b.gradient('radial', [
    { offset: 0, color: b.dark, opacity: 0.85 },
    { offset: 0.7, color: b.dark, opacity: 0.45 },
    { offset: 1, color: b.dark, opacity: 0 },
  ]);
  const glow = b.hotGradient();
  const parts: FxPart[] = [];
  for (let i = 0; i < n; i++) {
    const x = (L * (i + 0.5)) / n;
    const y = b.rnd(-1, 1) * grid * 0.2;
    const s = grid * b.rnd(0.55, 0.8);
    const delay = i * step;
    const k = Math.floor(b.rnd(4, 6));
    const rot = b.rnd(0, Math.PI * 2);
    const spikes = Array.from({ length: k }, (_, j): FxPart => {
      const a = rot + (j / k) * Math.PI * 2 + b.rnd(-0.35, 0.35);
      // Estacas longas e curtas alternadas, largas como lascas de rocha
      const len = s * (j % 2 ? b.rnd(0.6, 0.85) : b.rnd(1, 1.35));
      const w = s * b.rnd(0.38, 0.5);
      // Cristal: base no centro, lados que se alargam até ~40% e afinam até a ponta
      const dir = { x: Math.cos(a), y: Math.sin(a) };
      const perp = { x: -dir.y, y: dir.x };
      const at = (along: number, side: number) => ({ x: x + dir.x * along + perp.x * side, y: y + dir.y * along + perp.y * side });
      const pts = [at(0, -w * 0.3), at(len * 0.4, -w / 2), at(len, 0), at(len * 0.4, w / 2), at(0, w * 0.3)];
      return { tag: 'polygon', attrs: { points: toPointsAttr(pts), fill: spikeFill, stroke: b.dark, 'stroke-width': r2(b.ui(1)), 'stroke-linejoin': 'round' } };
    });
    parts.push(
      // Cratera no chão (fica até o fim)
      { tag: 'circle', attrs: { cx: r2(x), cy: r2(y), r: r2(s * 1.1), fill: crater }, anim: { name: 'fx-hold', duration: 1300, delay } },
      // Brilho e anel de impacto
      { tag: 'circle', attrs: { cx: r2(x), cy: r2(y), r: r2(s * 0.9), fill: glow, filter: FX_GLOW }, css: CENTER + '--s0:0.3;', anim: { name: 'fx-flash', duration: 450, delay } },
      { tag: 'circle', attrs: { cx: r2(x), cy: r2(y), r: r2(s * 1.7), fill: 'none', stroke: b.light, 'stroke-width': r2(b.thick(s, 0.06, 1.5)) }, css: CENTER + '--s0:0.3;', anim: { name: 'fx-grow', duration: 550, delay } },
      // Estacas: o grupo tem um círculo invisível centrado no ponto para "estourar" a partir do centro
      {
        tag: 'g',
        attrs: { filter: FX_GLOW },
        css: CENTER,
        anim: { name: 'fx-pop', duration: 1100, delay: delay + 40 },
        children: [{ tag: 'circle', attrs: { cx: r2(x), cy: r2(y), r: r2(s * 1.6), fill: 'none' } }, ...spikes],
      },
      // Destroços
      ...b.particles({ x, y, count: 7, dist: [s * 0.9, s * 2], size: [b.thick(s, 0.05, 1.5), b.thick(s, 0.11, 3)], colors: [b.dark, b.light, b.color], duration: [450, 700], delay: [delay, delay + 60] }),
    );
  }
  return { duration: (n - 1) * step + 1400, parts };
}

function vortex(b: FxBuilder, R: number): Built {
  /** Braço em espiral do raio R até perto do centro. */
  const arm = (start: number): Point[] =>
    Array.from({ length: 31 }, (_, i) => {
      const t = i / 30;
      const r = R * (1 - 0.92 * t);
      const a = start + t * Math.PI * 2 * 1.1;
      return { x: Math.cos(a) * r, y: Math.sin(a) * r };
    });
  const core = b.gradient('radial', [
    { offset: 0, color: '#05060a', opacity: 0.95 },
    { offset: 0.6, color: b.dark, opacity: 0.7 },
    { offset: 1, color: b.color, opacity: 0 },
  ]);
  const width = b.thick(R, 0.04, 2);
  return {
    duration: 1750,
    parts: [
      {
        tag: 'g',
        attrs: {},
        anim: { name: 'fx-hold', duration: 1650 },
        children: [
          {
            tag: 'g',
            attrs: {},
            css: CENTER + '--rot:-600deg;',
            anim: { name: 'fx-spin', duration: 1650, easing: 'cubic-bezier(.5,0,.7,1)' },
            children: [
              // Círculo invisível: centraliza o giro (caixa simétrica)
              { tag: 'circle', attrs: { r: r2(R * 1.15), fill: 'none' } },
              ...[0, 1, 2].map((k): FxPart => ({ tag: 'polyline', attrs: { points: toPointsAttr(arm((k * 2 * Math.PI) / 3)), fill: 'none', stroke: b.color, 'stroke-opacity': 0.8, 'stroke-width': r2(width), 'stroke-linecap': 'round', 'stroke-linejoin': 'round', filter: FX_GLOW } })),
              ...[0, 1, 2].map((k): FxPart => ({ tag: 'polyline', attrs: { points: toPointsAttr(arm((k * 2 * Math.PI) / 3 + Math.PI / 3)), fill: 'none', stroke: b.light, 'stroke-opacity': 0.6, 'stroke-width': r2(width * 0.45), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } })),
            ],
          },
        ],
      },
      { tag: 'circle', attrs: { r: r2(R * 0.3), fill: core }, css: CENTER, anim: { name: 'fx-pop', duration: 1650 } },
      // Partículas sugadas para o centro
      ...Array.from({ length: 20 }, (): FxPart => {
        const a = b.rnd(0, Math.PI * 2);
        const d = R * b.rnd(0.8, 1.15);
        const x = Math.cos(a) * d;
        const y = Math.sin(a) * d;
        return {
          tag: 'circle',
          attrs: { cx: r2(x), cy: r2(y), r: r2(b.thick(R, b.rnd(0.012, 0.025), 1.5)), fill: b.pick([b.light, b.color]) },
          css: CENTER + move(-x * 0.95, -y * 0.95, 0.2),
          anim: { name: 'fx-move', duration: b.rnd(700, 1100), delay: b.rnd(0, 500), easing: 'ease-in' },
        };
      }),
    ],
  };
}

// --- Magia -------------------------------------------------------------------

function heal(b: FxBuilder, R: number): Built {
  const glow = b.gradient('radial', [
    { offset: 0, color: b.light, opacity: 0.55 },
    { offset: 0.6, color: b.color, opacity: 0.25 },
    { offset: 1, color: b.color, opacity: 0 },
  ]);
  const parts: FxPart[] = [
    { tag: 'circle', attrs: { r: r2(R), fill: glow }, css: CENTER, anim: { name: 'fx-hold', duration: 1800 } },
    { tag: 'circle', attrs: { r: r2(R * 0.9), fill: 'none', stroke: b.light, 'stroke-width': r2(b.thick(R, 0.02, 1.5)) }, css: CENTER + '--s0:0.6;', anim: { name: 'fx-flash', duration: 900 } },
    // Brilhos subindo
    ...Array.from({ length: 18 }, (): FxPart => {
      const p = b.inside(R * 0.8);
      return {
        tag: 'circle',
        attrs: { cx: r2(p.x), cy: r2(p.y), r: r2(b.thick(R, b.rnd(0.015, 0.035), 1.5)), fill: b.pick([b.light, WHITE]), filter: FX_GLOW },
        css: CENTER + move(b.rnd(-R * 0.08, R * 0.08), -R * b.rnd(0.4, 0.9), 0.4),
        anim: { name: 'fx-move', duration: b.rnd(900, 1400), delay: b.rnd(0, 600), easing: 'ease-out' },
      };
    }),
  ];
  // Cruzes de cura subindo
  for (let i = 0; i < 5; i++) {
    const p = b.inside(R * 0.6);
    const s = R * b.rnd(0.06, 0.1);
    parts.push({
      tag: 'path',
      attrs: { d: `M ${r2(p.x - s)} ${r2(p.y)} H ${r2(p.x + s)} M ${r2(p.x)} ${r2(p.y - s)} V ${r2(p.y + s)}`, stroke: b.light, 'stroke-width': r2(s * 0.55), 'stroke-linecap': 'round', filter: FX_GLOW },
      css: CENTER + move(0, -R * b.rnd(0.5, 0.8), 0.6),
      anim: { name: 'fx-move', duration: b.rnd(1200, 1500), delay: b.rnd(100, 500), easing: 'ease-out' },
    });
  }
  return { duration: 2000, parts };
}

function shield(b: FxBuilder, R: number): Built {
  const hex = (r: number) => Array.from({ length: 6 }, (_, i) => ({ x: Math.cos((Math.PI / 3) * i + Math.PI / 6) * r, y: Math.sin((Math.PI / 3) * i + Math.PI / 6) * r }));
  const outer = hex(R);
  const width = b.thick(R, 0.035, 2);
  return {
    duration: 1850,
    parts: [
      {
        tag: 'g',
        attrs: {},
        css: CENTER,
        anim: { name: 'fx-pop', duration: 1750 },
        children: [
          { tag: 'polygon', attrs: { points: toPointsAttr(outer), fill: b.color, 'fill-opacity': 0.14, stroke: b.color, 'stroke-width': r2(width), 'stroke-linejoin': 'round', filter: FX_GLOW } },
          { tag: 'polygon', attrs: { points: toPointsAttr(hex(R * 0.58)), fill: 'none', stroke: b.light, 'stroke-opacity': 0.5, 'stroke-width': r2(width * 0.5) } },
          ...outer.map((v): FxPart => ({ tag: 'line', attrs: { x1: 0, y1: 0, x2: r2(v.x), y2: r2(v.y), stroke: b.light, 'stroke-opacity': 0.25, 'stroke-width': r2(b.ui(1)) } })),
          // Reflexo correndo pela borda
          { tag: 'polyline', attrs: { points: toPointsAttr([outer[2], outer[3], outer[4]]), fill: 'none', stroke: WHITE, 'stroke-width': r2(width * 0.9), 'stroke-linecap': 'round', 'stroke-linejoin': 'round', pathLength: 1, 'stroke-dasharray': 1 }, anim: { name: 'fx-draw', duration: 800, delay: 250 } },
        ],
      },
      ...b.particles({ count: 10, dist: [R * 0.95, R * 1.2], size: [b.ui(1), b.ui(2.2)], colors: [b.light, WHITE], duration: [600, 900], delay: [150, 600], s1: 0.6 }),
    ],
  };
}

/** Pequenos símbolos para o círculo de runas (em unidades de -1 a 1). */
const GLYPHS = [
  'M -1 -1 L 1 1 M 1 -1 L -1 1',
  'M 0 -1.2 V 1.2 M -1 -0.4 H 1',
  'M -1 1 L 0 -1 L 1 1',
  'M -1 -1 H 1 L -1 1 H 1',
  'M 0 -1.2 V 1.2 M 0 -0.2 L 1 -1 M 0 0.4 L -1 -0.4',
  'M -1 -1 V 1 H 1',
];

function rune(b: FxBuilder, R: number): Built {
  const width = b.thick(R, 0.025, 1.5);
  const g = R * 0.045;
  const glow = b.gradient('radial', [
    { offset: 0, color: b.color, opacity: 0.3 },
    { offset: 1, color: b.color, opacity: 0 },
  ]);
  const tri = (rot: number) => Array.from({ length: 3 }, (_, i) => ({ x: Math.cos(rot + (i * 2 * Math.PI) / 3) * R * 0.78, y: Math.sin(rot + (i * 2 * Math.PI) / 3) * R * 0.78 }));
  return {
    duration: 2150,
    parts: [
      { tag: 'circle', attrs: { r: r2(R * 1.2), fill: 'none', stroke: b.light, 'stroke-width': r2(width) }, css: CENTER + '--s0:0.2;', anim: { name: 'fx-grow', duration: 600 } },
      {
        tag: 'g',
        attrs: {},
        anim: { name: 'fx-hold', duration: 2050 },
        children: [
          { tag: 'circle', attrs: { r: r2(R * 1.05), fill: glow } },
          {
            tag: 'g',
            attrs: {},
            css: CENTER + '--rot:90deg;',
            anim: { name: 'fx-spin', duration: 2050, easing: 'linear' },
            children: [
              { tag: 'circle', attrs: { r: r2(R), fill: 'none', stroke: b.color, 'stroke-width': r2(width), filter: FX_GLOW } },
              { tag: 'circle', attrs: { r: r2(R * 0.82), fill: 'none', stroke: b.color, 'stroke-width': r2(width * 0.6) } },
              ...Array.from({ length: 12 }, (_, i): FxPart => {
                const a = (i / 12) * Math.PI * 2;
                return {
                  tag: 'path',
                  attrs: { d: b.pick(GLYPHS), transform: `translate(${r2(Math.cos(a) * R * 0.91)} ${r2(Math.sin(a) * R * 0.91)}) rotate(${r2((a * 180) / Math.PI + 90)}) scale(${r2(g)})`, fill: 'none', stroke: b.light, 'stroke-width': 0.35, 'stroke-linecap': 'round' },
                };
              }),
            ],
          },
          {
            tag: 'g',
            attrs: {},
            css: CENTER + '--rot:-120deg;',
            anim: { name: 'fx-spin', duration: 2050, easing: 'linear' },
            children: [
              { tag: 'polygon', attrs: { points: toPointsAttr(tri(-Math.PI / 2)), fill: 'none', stroke: b.light, 'stroke-width': r2(width * 0.7), 'stroke-linejoin': 'round', filter: FX_GLOW } },
              { tag: 'polygon', attrs: { points: toPointsAttr(tri(Math.PI / 2)), fill: 'none', stroke: b.light, 'stroke-width': r2(width * 0.7), 'stroke-linejoin': 'round', filter: FX_GLOW } },
              { tag: 'circle', attrs: { r: r2(R * 0.32), fill: 'none', stroke: b.color, 'stroke-width': r2(width * 0.6) } },
            ],
          },
        ],
      },
    ],
  };
}

function teleport(b: FxBuilder, R: number): Built {
  const ground = b.gradient('radial', [
    { offset: 0, color: b.light, opacity: 0.6 },
    { offset: 0.6, color: b.color, opacity: 0.3 },
    { offset: 1, color: b.color, opacity: 0 },
  ]);
  const pillar = b.gradient('linear', [
    { offset: 0, color: b.color, opacity: 0 },
    { offset: 0.45, color: b.color, opacity: 0.45 },
    { offset: 0.85, color: b.light, opacity: 0.85 },
    { offset: 1, color: WHITE, opacity: 0.95 },
  ], true);
  const core = b.gradient('linear', [
    { offset: 0, color: WHITE, opacity: 0 },
    { offset: 1, color: WHITE, opacity: 0.9 },
  ], true);
  const width = b.thick(R, 0.03, 2);
  return {
    duration: 1550,
    parts: [
      { tag: 'ellipse', attrs: { rx: r2(R), ry: r2(R * 0.38), fill: ground }, css: CENTER, anim: { name: 'fx-hold', duration: 1450 } },
      ...[0, 250].map((delay): FxPart => ({ tag: 'ellipse', attrs: { rx: r2(R), ry: r2(R * 0.38), fill: 'none', stroke: b.color, 'stroke-width': r2(width), filter: FX_GLOW }, css: CENTER + '--s0:0.3;', anim: { name: 'fx-flash', duration: 700, delay } })),
      { tag: 'rect', attrs: { x: r2(-R * 0.45), y: r2(-R * 2.6), width: r2(R * 0.9), height: r2(R * 2.6), rx: r2(R * 0.45), fill: pillar, filter: FX_GLOW }, css: BOTTOM, anim: { name: 'fx-rise', duration: 1300 } },
      { tag: 'rect', attrs: { x: r2(-R * 0.09), y: r2(-R * 2.4), width: r2(R * 0.18), height: r2(R * 2.4), rx: r2(R * 0.09), fill: core }, css: BOTTOM, anim: { name: 'fx-rise', duration: 1100, delay: 80 } },
      ...Array.from({ length: 22 }, (): FxPart => ({
        tag: 'circle',
        attrs: { cx: r2(b.rnd(-R * 0.8, R * 0.8)), cy: r2(b.rnd(-R * 0.25, R * 0.25)), r: r2(b.thick(R, b.rnd(0.012, 0.03), 1.5)), fill: b.pick([b.light, WHITE]) },
        css: CENTER + move(b.rnd(-R * 0.1, R * 0.1), -R * b.rnd(1.2, 2.6), 0.3),
        anim: { name: 'fx-move', duration: b.rnd(900, 1300), delay: b.rnd(0, 500), easing: 'ease-out' },
      })),
      { tag: 'ellipse', attrs: { rx: r2(R * 0.7), ry: r2(R * 0.26), fill: WHITE }, css: CENTER, anim: { name: 'fx-flash', duration: 350 } },
    ],
  };
}

// --- Internos ------------------------------------------------------------------

/** Arredonda para 2 casas (atributos menores no DOM). */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Variáveis CSS do deslocamento de uma partícula. */
function move(dx: number, dy: number, s1: number): string {
  return `--dx:${r2(dx)}px;--dy:${r2(dy)}px;--s1:${r2(s1)};`;
}

/** Momento (ms) em que a última animação termina, inclusive nos filhos. */
function lastEnd(parts: FxPart[]): number {
  return parts.reduce((max, p) => {
    const own = p.anim ? (p.anim.delay ?? 0) + p.anim.duration * (p.anim.iterations ?? 1) : 0;
    return Math.max(max, own, lastEnd(p.children ?? []));
  }, 0);
}

/** Atrasa todas as animações (inclusive as dos filhos). */
function delayParts(parts: FxPart[], ms: number): FxPart[] {
  return parts.map((p) => ({
    ...p,
    anim: p.anim && { ...p.anim, delay: (p.anim.delay ?? 0) + ms },
    children: p.children && delayParts(p.children, ms),
  }));
}

function parseHex(hex: string): number[] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0);
}
