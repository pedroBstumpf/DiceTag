import { randomInt } from 'node:crypto';
import {
  MANA_BAR,
  findPlacement,
  manaCost,
  normalizeSheet,
  rollDice,
  tokenSheetPlacement,
  withPowers,
  type ChatMessage,
  type RollConfig,
  type TableCommand,
  type TableEntry,
  type TableState,
  type TokenBar,
  type Viewer,
} from '../domain';
import { canEditEntry } from './command-rules';

/**
 * Rolagem de dados no servidor (SPEC.md §3.2): o cliente envia a intenção (dados, modificador
 * fixo, tags ligadas) e o servidor:
 * 1. confere se a conta pode agir com aquela ficha;
 * 2. recalcula os níveis das tags com a ficha ATUAL (não confia em número vindo do cliente);
 * 3. confere e gasta a Mana (Espírito) das tags mágicas;
 * 4. sorteia com o gerador criptográfico (`crypto.randomInt`), usando o mesmo `rollDice` do
 *    front-end.
 *
 * Função pura (o sorteio e o relógio entram como parâmetros): testável sem servidor.
 * Ainda não recalculados aqui: etiquetas de itens equipados, de status e estudos (valem 0).
 */

export interface RollRequest {
  sheetId?: string;
  roll: RollConfig;
  label: string;
  icon: string;
}

export type RollOutcomeResult =
  | { ok: true; message: ChatMessage; commands: TableCommand[] }
  | { ok: false; reason: string };

/** Sorteio uniforme 0 ≤ x < 1 com o gerador criptográfico do sistema. */
export const cryptoRandom = (): number => randomInt(0, 2 ** 48 - 1) / 2 ** 48;

/** Ficha usada na rolagem: de onde vêm as tags, a Mana e como gravar o gasto. */
interface SheetSource {
  entry: TableEntry;
  name: string;
  themes: ReturnType<typeof normalizeSheet>['themes'];
  bars: TokenBar[];
  /** Comando que grava as barras depois do gasto (null = não é possível gastar aqui). */
  spend: ((bars: TokenBar[]) => TableCommand) | null;
}

function sheetSource(state: TableState, sheetId: string): SheetSource | null {
  const placementId = tokenSheetPlacement(sheetId);
  if (placementId) {
    const placement = findPlacement(state.scenes, placementId);
    const entry = placement && state.entries.find((e) => e.id === placement.entryId);
    if (!placement || entry?.kind !== 'npc') return null;
    return {
      entry,
      name: placement.name ?? entry.name,
      themes: normalizeSheet(placement.sheet ?? entry.sheet).themes,
      bars: placement.bars ?? entry.token?.bars ?? [],
      spend: (bars) => ({ type: 'updatePlacement', payload: { placementId, patch: { bars } } }),
    };
  }
  const entry = state.entries.find((e) => e.id === sheetId);
  if (entry?.kind !== 'character' && entry?.kind !== 'npc') return null;
  const token = entry.token;
  return {
    entry,
    name: entry.name,
    themes: normalizeSheet(entry.sheet).themes,
    bars: token?.bars ?? [],
    // NPC do bestiário (referência): ficha e barras moram no mundo — gasto ainda não suportado aqui
    spend: token ? (bars) => ({ type: 'updateEntry', payload: { entryId: entry.id, patch: { token: { ...token, bars } } } }) : null,
  };
}

export function performRoll(
  state: TableState,
  request: RollRequest,
  viewer: Viewer & { userId: string },
  userName: string,
  now: number,
  messageId: string,
  random: () => number = cryptoRandom,
): RollOutcomeResult {
  const source = request.sheetId ? sheetSource(state, request.sheetId) : null;
  if (request.sheetId && !source) return { ok: false, reason: 'Ficha não encontrada.' };
  if (source && !canEditEntry(state, source.entry, viewer)) return { ok: false, reason: 'Você não pode rolar por esta ficha.' };

  // Níveis atuais das tags e defeitos dos temas (defeitos já são negativos)
  const themeTags = (source?.themes ?? []).flatMap((t) => [...t.tags, ...t.flaws]);
  const levels = new Map(themeTags.map((t) => [t.id, t.level]));
  const magic = new Set((source?.themes ?? []).flatMap((t) => t.tags.filter((tag) => tag.magic).map((tag) => tag.id)));
  const effective = withPowers(request.roll, levels, magic);
  const cost = manaCost(request.roll, effective, magic);

  const commands: TableCommand[] = [];
  if (cost > 0) {
    const mana = source?.bars.find((b) => b.id === MANA_BAR);
    if (!source?.spend || !mana) return { ok: false, reason: 'Esta ficha não tem Espírito para gastar.' };
    if (mana.value < cost) return { ok: false, reason: `Espírito insuficiente (precisa de ${cost}).` };
    commands.push(source.spend(source.bars.map((b) => (b.id === MANA_BAR ? { ...b, value: Math.max(0, b.value - cost) } : b))));
  }

  const result = rollDice(request.roll, random, effective);
  const message: ChatMessage = {
    id: messageId,
    at: now,
    userId: viewer.userId,
    author: source?.name ?? (viewer.role === 'gm' ? 'Mestre' : userName),
    role: viewer.role,
    roll: {
      action: request.label.trim() || 'Rolagem',
      icon: request.icon.trim() || 'casino',
      dice: request.roll.dice,
      ...result,
      ...(cost > 0 && { mana: cost }),
    },
  };
  commands.push({ type: 'addChatMessage', payload: { message } });
  return { ok: true, message, commands };
}
