import { FX_KINDS } from '../../../core/models/table-session.model';
import { FxPart, buildFx, displaceLine, fxCss, fxFrame, isRadialFx, mixColor, seededRandom, toPointsAttr } from './effects';

/** Animações definidas em src/styles/tailwind.css (@keyframes fx-*). */
const KEYFRAMES = new Set([
  'fx-draw', 'fx-blast', 'fx-grow', 'fx-flash', 'fx-move', 'fx-smoke', 'fx-travel', 'fx-fall', 'fx-flicker',
  'fx-swipe', 'fx-cone', 'fx-beam', 'fx-hold', 'fx-pop', 'fx-rise', 'fx-spin', 'fx-pulse',
]);

function flatten(parts: FxPart[]): FxPart[] {
  return parts.flatMap((p) => [p, ...flatten(p.children ?? [])]);
}

describe('fxFrame', () => {
  it('calcula comprimento e ângulo do arraste', () => {
    expect(fxFrame({ x: 0, y: 0 }, { x: 3, y: 4 }).length).toBe(5);
    expect(fxFrame({ x: 0, y: 0 }, { x: 0, y: 10 }).angle).toBe(90);
    expect(fxFrame({ x: 5, y: 5 }, { x: 0, y: 5 }).angle).toBe(180);
  });
});

describe('displaceLine', () => {
  it('mantém as pontas e dobra os segmentos a cada nível', () => {
    const pts = displaceLine({ x: 0, y: 0 }, { x: 100, y: 0 }, 20, 3, seededRandom(1));
    expect(pts).toHaveLength(9);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[8]).toEqual({ x: 100, y: 0 });
    // Desvio total limitado a roughness × (1 + ½ + ¼)
    for (const p of pts) expect(Math.abs(p.y)).toBeLessThanOrEqual(35);
  });
});

describe('utilitários', () => {
  it('sorteio semeado é reproduzível', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('mistura cores', () => {
    expect(mixColor('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixColor('#ff0000', '#0000ff', 0)).toBe('#ff0000');
  });

  it('CSS da animação com adiantamento e pausa (capturas)', () => {
    const css = fxCss({ tag: 'circle', attrs: {}, css: 'a:b;', anim: { name: 'fx-grow', duration: 500, delay: 100 } }, 300, true);
    expect(css).toBe('a:b;animation:fx-grow 500ms ease-out -200ms 1 both;animation-play-state:paused;');
    expect(toPointsAttr([{ x: 1, y: 2 }, { x: 3.456, y: 4 }])).toBe('1,2 3.46,4');
  });
});

describe('buildFx (todos os efeitos)', () => {
  for (const kind of FX_KINDS) {
    it(`${kind.label}: gradientes existentes, animações conhecidas, duração positiva`, () => {
      const d = buildFx(kind.id, '#ff7a1a', { x: 100, y: 100 }, { x: 300, y: 160 }, { uid: 'fx-t', scale: 1, grid: 70, random: seededRandom(3) });
      const parts = flatten(d.parts);
      expect(parts.length).toBeGreaterThan(0);
      expect(d.duration).toBeGreaterThan(0);

      const ids = new Set(d.gradients.map((g) => g.id));
      expect(ids.size).toBe(d.gradients.length);
      for (const id of ids) expect(id.startsWith('fx-t-')).toBe(true);

      for (const p of parts) {
        for (const value of Object.values(p.attrs)) {
          const ref = /^url\(#(.+)\)$/.exec(String(value))?.[1];
          if (ref && ref !== 'dt-fx-glow') expect(ids.has(ref)).toBe(true);
          expect(String(value)).not.toContain('NaN');
        }
        if (p.anim) {
          expect(KEYFRAMES.has(p.anim.name)).toBe(true);
          // Nenhuma parte termina depois do fim do efeito (senão seria cortada)
          expect((p.anim.delay ?? 0) + p.anim.duration * (p.anim.iterations ?? 1)).toBeLessThanOrEqual(d.duration + 1);
        }
      }

      // Radiais não giram; os demais apontam para o alvo
      expect(d.transform.includes('rotate')).toBe(!isRadialFx(kind.id));
    });
  }

  it('mesma semente = mesmo desenho', () => {
    const make = () => buildFx('lightning', '#ffe14d', { x: 0, y: 0 }, { x: 200, y: 0 }, { uid: 'a', scale: 1, grid: 70, random: seededRandom(9) });
    expect(make()).toEqual(make());
  });
});
