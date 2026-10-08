import { DiceKind, RollConfig, RollOutcome } from '../../../core/models/table-session.model';

/** Quantidade de dados e faces de cada tipo de rolagem. */
const DICE: Record<DiceKind, { count: number; sides: number }> = {
  '2d12': { count: 2, sides: 12 },
  '3d6': { count: 3, sides: 6 },
};

/** Fonte de aleatoriedade (0 ≤ x < 1); injetável nos testes. */
export type Random = () => number;

/** Nível atual de cada tag do personagem, por id (tags e defeitos dos temas da ficha). */
export type TagLevels = ReadonlyMap<string, number>;
const NO_LEVELS: TagLevels = new Map();

/**
 * Modificador efetivo da rolagem: o valor fixo + o nível atual de cada tag ligada
 * (`roll.attributes`, ids de tags dos temas; defeitos têm nível negativo).
 * Tags que não existem mais valem 0. Como o nível é lido na hora, subir uma tag
 * na ficha já muda todas as ações que a usam.
 */
export function effectiveModifier(roll: RollConfig, levels: TagLevels = NO_LEVELS): number {
  return (roll.attributes ?? []).reduce((sum, id) => sum + (levels.get(id) ?? 0), roll.modifier);
}

/** Etiqueta de status ligada na rolagem básica: soma (+1) ou subtrai (−1) o nível dela. */
export interface StatusPick {
  /** Nível da etiqueta (ausente ou 0 = sem nível: vale 1). */
  level?: number;
  sign: 1 | -1;
}

/**
 * Modificador da rolagem básica (botão "Rolar dados", não salvo como ação): valor fixo +
 * nível das tags/defeitos dos temas escolhidos (defeitos já são negativos) + etiquetas de
 * status escolhidas, cada uma como bônus ou penalidade.
 */
export function quickModifier(fixed: number, themeLevels: readonly number[], status: readonly StatusPick[]): number {
  const themes = themeLevels.reduce((sum, level) => sum + level, 0);
  return status.reduce((sum, pick) => sum + pick.sign * (pick.level || 1), fixed + themes);
}

/** Rola os dados de `roll` e classifica o total. */
export function rollDice(roll: RollConfig, random: Random = Math.random, levels: TagLevels = NO_LEVELS) {
  const { count, sides } = DICE[roll.dice];
  const rolls = Array.from({ length: count }, () => 1 + Math.floor(random() * sides));
  const modifier = effectiveModifier(roll, levels);
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

/** Fórmula legível com o modificador efetivo: "2d12+3". */
export function formatRoll(roll: RollConfig, levels: TagLevels = NO_LEVELS): string {
  return roll.dice + formatModifier(effectiveModifier(roll, levels));
}
