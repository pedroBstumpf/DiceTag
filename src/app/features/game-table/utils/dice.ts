import { CharacterStudy, DiceKind, RollConfig, RollOutcome, RollResult } from '../../../core/models/table-session.model';

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

/**
 * A rolagem usa etiquetas (tags dos temas, itens, status, estudos)? Só o 2d12: o 3d6 (sorte)
 * recebe apenas o modificador fixo escolhido na hora.
 */
export function rollUsesTags(dice: DiceKind): boolean {
  return dice === '2d12';
}

/** Soma o nível atual das tags ligadas (penalidades subtraem); `only` filtra quais entram. 3d6 = 0. */
function sumAttributes(roll: RollConfig, levels: TagLevels, only: (attribute: string) => boolean): number {
  if (!rollUsesTags(roll.dice)) return 0;
  return (roll.attributes ?? []).filter(only).reduce((sum, id) => sum + attributeSign(id) * (levels.get(baseTagId(id)) ?? 0), 0);
}

/**
 * Modificador efetivo da rolagem: o valor fixo + o nível atual de cada tag ligada
 * (`roll.attributes`: tags dos temas, com defeitos de nível negativo, e etiquetas de itens
 * equipados, que podem estar ligadas como penalidade). Tags que não existem mais valem 0.
 * Como o nível é lido na hora, subir uma tag na ficha já muda todas as ações que a usam.
 * No 3d6 as tags são ignoradas (ficam salvas na ação, caso ela volte a ser 2d12).
 * As etiquetas de itens só entram com `roll.addItems` (padrão: ficam fora do total).
 */
export function effectiveModifier(roll: RollConfig, levels: TagLevels = NO_LEVELS): number {
  return roll.modifier + sumAttributes(roll, levels, (attribute) => !!roll.addItems || !isItemAttribute(attribute));
}

/** Valor das etiquetas de itens equipados ligadas (exibido à parte no chat, somado ou não ao total). */
export function itemModifier(roll: RollConfig, levels: TagLevels = NO_LEVELS): number {
  return sumAttributes(roll, levels, isItemAttribute);
}

/**
 * Modificador do personagem numa rolagem já feita (fixo + tags + status, sem os itens).
 * Rolagens antigas (sem `itemsAdded`) somavam os itens em `modifier`: eles são descontados.
 */
export function characterModifier(roll: Pick<RollResult, 'modifier' | 'itemModifier' | 'itemsAdded'>): number {
  return roll.itemsAdded === false ? roll.modifier : roll.modifier - (roll.itemModifier ?? 0);
}

// --- Tags mágicas: Poder e Mana ------------------------------------------------

/** Poder de uma tag mágica: o escolhido, entre 1 e o nível atual (sem escolha = o nível). */
export function powerOf(level: number, chosen?: number): number {
  if (level < 1) return 0;
  return Math.min(level, Math.max(1, Math.round(chosen ?? level)));
}

/**
 * Níveis das tags com o Poder no lugar do nível nas tags mágicas (`magic` = ids delas),
 * conforme `roll.powers`. É o que a rolagem e a fórmula da ação usam.
 */
export function withPowers(roll: RollConfig, levels: TagLevels, magic: ReadonlySet<string>): TagLevels {
  if (!magic.size) return levels;
  const next = new Map(levels);
  for (const id of magic) {
    const level = levels.get(id);
    if (level !== undefined) next.set(id, powerOf(level, roll.powers?.[id]));
  }
  return next;
}

/**
 * Mana gasta pela rolagem: a soma do Poder das tags mágicas ligadas (`levels` já com o Poder,
 * de `withPowers`). 3d6 não usa tags, então não gasta.
 */
export function manaCost(roll: RollConfig, levels: TagLevels, magic: ReadonlySet<string>): number {
  if (!rollUsesTags(roll.dice)) return 0;
  return (roll.attributes ?? [])
    .filter((a) => attributeSign(a) > 0 && magic.has(baseTagId(a)))
    .reduce((sum, a) => sum + Math.max(0, levels.get(baseTagId(a)) ?? 0), 0);
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
 * Rola os dados de `roll` e classifica o total. `itemModifier` = valor das etiquetas de itens
 * ligadas; `itemsAdded` diz se ele entrou em `modifier` (e no total).
 */
export function rollDice(roll: RollConfig, random: Random = Math.random, levels: TagLevels = NO_LEVELS) {
  const { count, sides } = DICE[roll.dice];
  const rolls = Array.from({ length: count }, () => 1 + Math.floor(random() * sides));
  const modifier = effectiveModifier(roll, levels);
  const total = rolls.reduce((sum, r) => sum + r, 0) + modifier;
  return {
    rolls,
    modifier,
    itemModifier: itemModifier(roll, levels),
    itemsAdded: !!roll.addItems,
    total,
    outcome: rollOutcome(roll.dice, total),
  };
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

// --- Estudos e Treinos ---------------------------------------------------------

/**
 * SA ganhos por um estudo ligado à rolagem: 2 no sucesso crítico, 1 com total 12 ou mais,
 * −1 na falha crítica (o estudo regride), senão 0.
 * Rolagens de 3d6 não usam etiquetas, então não treinam.
 */
export function studyGain(total: number, outcome: RollOutcome): number {
  if (outcome === 'bad-luck' || outcome === 'neutral' || outcome === 'good-luck') return 0;
  if (outcome === 'critical-success') return 2;
  if (outcome === 'critical-failure') return -1;
  return total >= 12 ? 1 : 0;
}

/**
 * Soma `gain` SA ao estudo (negativo na falha crítica; o SA nunca fica abaixo de 0).
 * `leveledUp`: passou a alcançar o SN nesta rolagem (o SN precisa estar definido, > 0,
 * e o estudo ainda não o tinha alcançado).
 */
export function trainStudy(study: CharacterStudy, gain: number): { study: CharacterStudy; leveledUp: boolean } {
  const sa = Math.max(0, study.sa + gain);
  return { study: { ...study, sa }, leveledUp: study.sn > 0 && study.sa < study.sn && sa >= study.sn };
}

/** Aviso de estudos que subiram de nível: "⭐ Esgrima subiu de nível!" (um por linha). */
export function levelUpText(names: readonly string[]): string {
  return names.map((name) => `⭐ ${name} subiu de nível!`).join('\n');
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
