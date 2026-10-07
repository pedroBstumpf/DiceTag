import { DiceKind, RollConfig, RollOutcome } from '../../../core/models/table-session.model';

/** Quantidade de dados e faces de cada tipo de rolagem. */
const DICE: Record<DiceKind, { count: number; sides: number }> = {
  '2d12': { count: 2, sides: 12 },
  '3d6': { count: 3, sides: 6 },
};

/** Fonte de aleatoriedade (0 ≤ x < 1); injetável nos testes. */
export type Random = () => number;

/**
 * Modificador efetivo da rolagem.
 * Hoje é só o valor fixo; quando a ficha existir, os atributos em `roll.attributes`
 * serão somados aqui (ex.: `attributeValue(id)`), sem mudar quem chama.
 */
export function effectiveModifier(roll: RollConfig): number {
  return roll.modifier;
}

/** Rola os dados de `roll` e classifica o total. */
export function rollDice(roll: RollConfig, random: Random = Math.random) {
  const { count, sides } = DICE[roll.dice];
  const rolls = Array.from({ length: count }, () => 1 + Math.floor(random() * sides));
  const modifier = effectiveModifier(roll);
  const total = rolls.reduce((sum, r) => sum + r, 0) + modifier;
  return { rolls, modifier, total, outcome: rollOutcome(roll.dice, total) };
}

/**
 * Resultado do total:
 * - 2d12: < 0 falha crítica · < 12 falha · < 17 sucesso parcial · < 24 sucesso · 24+ sucesso crítico
 * - 3d6: até 9 azar · 10–12 neutro · 13+ sorte
 */
export function rollOutcome(dice: DiceKind, total: number): RollOutcome {
  if (dice === '3d6') return total <= 9 ? 'bad-luck' : total <= 12 ? 'neutral' : 'good-luck';
  if (total < 0) return 'critical-failure';
  if (total < 12) return 'failure';
  if (total < 17) return 'partial';
  if (total < 24) return 'success';
  return 'critical-success';
}

/** Modificador como texto: "+3", "−2" ou "" (zero). */
export function formatModifier(modifier: number): string {
  if (!modifier) return '';
  return modifier > 0 ? `+${modifier}` : `−${Math.abs(modifier)}`;
}

/** Fórmula legível: "2d12+3". */
export function formatRoll(roll: RollConfig): string {
  return roll.dice + formatModifier(effectiveModifier(roll));
}
