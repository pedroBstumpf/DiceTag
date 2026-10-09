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

// --- Tags ligadas às ações (`RollConfig.attributes`) -------------------------

/** Prefixo dos ids de etiquetas de itens equipados (`item:<linha do inventário>:<etiqueta>`). */
export const ITEM_TAG_PREFIX = 'item:';
/** Prefixo de tag ligada como penalidade (subtrai o nível): usado nas etiquetas de itens. */
export const NEGATED_TAG_PREFIX = '-';

/** Id da tag sem o prefixo de penalidade. */
export function baseTagId(attribute: string): string {
  return attribute.startsWith(NEGATED_TAG_PREFIX) ? attribute.slice(NEGATED_TAG_PREFIX.length) : attribute;
}

/** Sinal da tag ligada: −1 se ligada como penalidade, senão 1. */
export function attributeSign(attribute: string): 1 | -1 {
  return attribute.startsWith(NEGATED_TAG_PREFIX) ? -1 : 1;
}

/** É etiqueta de item equipado (com ou sem o prefixo de penalidade)? */
export function isItemAttribute(attribute: string): boolean {
  return baseTagId(attribute).startsWith(ITEM_TAG_PREFIX);
}

/**
 * Tags de uma ação sem as etiquetas de itens que não estão mais equipados (`valid` = ids
 * das etiquetas de itens equipados agora). Tags dos temas ficam. null = nada mudou.
 */
export function keepValidItemTags(attributes: readonly string[], valid: ReadonlySet<string>): string[] | null {
  const kept = attributes.filter((id) => !isItemAttribute(id) || valid.has(baseTagId(id)));
  return kept.length === attributes.length ? null : kept;
}

/** Soma o nível atual das tags ligadas (penalidades subtraem); `only` filtra quais entram. */
function sumAttributes(roll: RollConfig, levels: TagLevels, only: (attribute: string) => boolean): number {
  return (roll.attributes ?? []).filter(only).reduce((sum, id) => sum + attributeSign(id) * (levels.get(baseTagId(id)) ?? 0), 0);
}

/**
 * Modificador efetivo da rolagem: o valor fixo + o nível atual de cada tag ligada
 * (`roll.attributes`: tags dos temas, com defeitos de nível negativo, e etiquetas de itens
 * equipados, que podem estar ligadas como penalidade). Tags que não existem mais valem 0.
 * Como o nível é lido na hora, subir uma tag na ficha já muda todas as ações que a usam.
 */
export function effectiveModifier(roll: RollConfig, levels: TagLevels = NO_LEVELS): number {
  return roll.modifier + sumAttributes(roll, levels, () => true);
}

/** Parte do modificador que vem das etiquetas de itens equipados (exibida à parte no chat). */
export function itemModifier(roll: RollConfig, levels: TagLevels = NO_LEVELS): number {
  return sumAttributes(roll, levels, isItemAttribute);
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

/**
 * Rola os dados de `roll` e classifica o total. `itemModifier` = parte do modificador que
 * vem dos itens equipados (já incluída em `modifier`).
 */
export function rollDice(roll: RollConfig, random: Random = Math.random, levels: TagLevels = NO_LEVELS) {
  const { count, sides } = DICE[roll.dice];
  const rolls = Array.from({ length: count }, () => 1 + Math.floor(random() * sides));
  const modifier = effectiveModifier(roll, levels);
  const total = rolls.reduce((sum, r) => sum + r, 0) + modifier;
  return { rolls, modifier, itemModifier: itemModifier(roll, levels), total, outcome: rollOutcome(roll.dice, total) };
}

/**
 * Resultado do total:
 * - 2d12: < 0 falha crítica · < 12 falha · 12–17 sucesso parcial · 18–23 sucesso · 24+ sucesso crítico
 * - 3d6: até 9 azar · 10–12 neutro · 13+ sorte
 */
export function rollOutcome(dice: DiceKind, total: number): RollOutcome {
  if (dice === '3d6') return total <= 9 ? 'bad-luck' : total <= 12 ? 'neutral' : 'good-luck';
  if (total < 0) return 'critical-failure';
  if (total < 12) return 'failure';
  if (total < 18) return 'partial';
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
