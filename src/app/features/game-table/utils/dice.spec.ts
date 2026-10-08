import { effectiveModifier, formatModifier, formatRoll, rollDice, rollOutcome } from './dice';

/** Random que devolve os valores na ordem (para dados previsíveis). */
function sequence(...values: number[]) {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('rollOutcome', () => {
  it('2d12: faixas de falha crítica a sucesso crítico', () => {
    expect(rollOutcome('2d12', -1)).toBe('critical-failure');
    expect(rollOutcome('2d12', 0)).toBe('failure');
    expect(rollOutcome('2d12', 11)).toBe('failure');
    expect(rollOutcome('2d12', 12)).toBe('partial');
    expect(rollOutcome('2d12', 16)).toBe('partial');
    expect(rollOutcome('2d12', 17)).toBe('success');
    expect(rollOutcome('2d12', 23)).toBe('success');
    expect(rollOutcome('2d12', 24)).toBe('critical-success');
    expect(rollOutcome('2d12', 30)).toBe('critical-success');
  });

  it('3d6: azar, neutro e sorte (inclusive fora de 3–18 com modificador)', () => {
    expect(rollOutcome('3d6', 1)).toBe('bad-luck');
    expect(rollOutcome('3d6', 9)).toBe('bad-luck');
    expect(rollOutcome('3d6', 10)).toBe('neutral');
    expect(rollOutcome('3d6', 12)).toBe('neutral');
    expect(rollOutcome('3d6', 13)).toBe('good-luck');
    expect(rollOutcome('3d6', 21)).toBe('good-luck');
  });
});

describe('rollDice', () => {
  it('rola a quantidade certa de dados e soma o modificador', () => {
    // 0 → 1; 0.999 → face máxima
    const r = rollDice({ dice: '2d12', modifier: 3 }, sequence(0, 0.999));
    expect(r.rolls).toEqual([1, 12]);
    expect(r.total).toBe(16);
    expect(r.outcome).toBe('partial');
  });

  it('3d6 usa três dados de seis faces', () => {
    const r = rollDice({ dice: '3d6', modifier: -2 }, sequence(0.999));
    expect(r.rolls).toEqual([6, 6, 6]);
    expect(r.total).toBe(16);
    expect(r.outcome).toBe('good-luck');
  });

  it('dados ficam sempre entre 1 e o número de faces', () => {
    for (let i = 0; i < 200; i++) {
      for (const d of rollDice({ dice: '2d12', modifier: 0 }).rolls) {
        expect(d).toBeGreaterThanOrEqual(1);
        expect(d).toBeLessThanOrEqual(12);
      }
    }
  });
});

describe('formatação', () => {
  it('modificador e fórmula', () => {
    expect(formatModifier(0)).toBe('');
    expect(formatModifier(4)).toBe('+4');
    expect(formatModifier(-2)).toBe('−2');
    expect(formatRoll({ dice: '3d6', modifier: 1 })).toBe('3d6+1');
  });
});

describe('tags do personagem no modificador', () => {
  const levels = new Map([
    ['esgrima', 3],
    ['medo', -2],
  ]);

  it('soma o nível atual das tags ligadas (defeitos subtraem)', () => {
    const roll = { dice: '2d12' as const, modifier: 1, attributes: ['esgrima', 'medo'] };
    expect(effectiveModifier(roll, levels)).toBe(2);
    expect(formatRoll(roll, levels)).toBe('2d12+2');
  });

  it('tag removida vale 0; subir a tag muda o modificador', () => {
    const roll = { dice: '2d12' as const, modifier: 0, attributes: ['esgrima', 'apagada'] };
    expect(effectiveModifier(roll, levels)).toBe(3);
    expect(effectiveModifier(roll, new Map([['esgrima', 5]]))).toBe(5);
  });

  it('rollDice usa o modificador efetivo', () => {
    const r = rollDice({ dice: '2d12', modifier: 0, attributes: ['esgrima'] }, sequence(0), levels);
    expect(r.modifier).toBe(3);
    expect(r.total).toBe(5);
  });
});
