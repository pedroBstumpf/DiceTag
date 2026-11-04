import { randomInt } from 'node:crypto';
import {
  MANA_BAR,
  baseTagId,
  equippedTagLevels,
  findPlacement,
  levelUpText,
  manaCost,
  normalizeSheet,
  npcSheetOf,
  npcTokenOf,
  rollDice,
  studyGain,
  tokenSheetPlacement,
  trainStudy,
  withPowers,
  type CharacterSheet,
  type ChatMessage,
  type RollConfig,
  type TableCommand,
  type TableEntry,
  type TableState,
  type TokenBar,
  type TokenSettings,
  type Viewer,
  type WorldItem,
} from '../domain';
import { canEditEntry } from './command-rules';
import { emptyWorld, type WorldView } from './world';

/**
 * Rolagem de dados no servidor (SPEC.md §3.2): o cliente envia a intenção (dados, modificador
 * fixo, tags ligadas) e o servidor:
 * 1. confere se a conta pode agir com aquela ficha;
 * 2. recalcula os níveis das tags dos temas e das etiquetas dos itens equipados com a ficha ATUAL
 *    (não confia em número vindo do cliente);
 * 3. confere e gasta a Mana (Espírito) das tags mágicas;
 * 4. sorteia com o gerador criptográfico (`crypto.randomInt`), usando o mesmo `rollDice` do
 *    front-end;
 * 5. aplica Estudos e Treinos e avisa no chat quem subiu de nível.
 *
 * O modificador fixo é o que a pessoa digita (é livre também na mesa local) e traz as etiquetas de
 * status do "Rolar", que valem o que quem rola escolher naquela hora.
 *
 * Função pura (o sorteio e o relógio entram como parâmetros): testável sem servidor.
 */

export interface RollRequest {
  sheetId?: string;
  roll: RollConfig;
  label: string;
  icon: string;
  /** Estudos ligados só a esta rolagem (na ação, vêm em `roll.attributes`). */
  studies?: string[];
}

export type RollOutcomeResult =
  | {
      ok: true;
      message: ChatMessage;
      commands: TableCommand[];
      /** NPC do bestiário: o gasto de Mana vai para o mundo, não para a mesa. */
      world?: { item: WorldItem; token: TokenSettings };
    }
  | { ok: false; reason: string };

/** Sorteio uniforme 0 ≤ x < 1 com o gerador criptográfico do sistema. */
export const cryptoRandom = (): number => randomInt(0, 2 ** 48 - 1) / 2 ** 48;

/** Ficha usada na rolagem: de onde vêm as tags, a Mana e como gravar o gasto. */
interface SheetSource {
  entry: TableEntry;
  name: string;
  sheet: CharacterSheet;
  bars: TokenBar[];
  /** Comando que grava as barras depois do gasto (null = não é na mesa: ver `worldNpc`, ou não dá para gastar). */
  spend: ((bars: TokenBar[]) => TableCommand) | null;
  /** NPC do bestiário cuja ficha base está em uso: o gasto de Mana é gravado nele. */
  worldNpc?: WorldItem;
  /** Comando que grava os estudos (só personagens têm estudos). */
  saveSheet?: (sheet: CharacterSheet) => TableCommand;
}

function sheetSource(state: TableState, sheetId: string, world: WorldView): SheetSource | null {
  const placementId = tokenSheetPlacement(sheetId);
  if (placementId) {
    const placement = findPlacement(state.scenes, placementId);
    const entry = placement && state.entries.find((e) => e.id === placement.entryId);
    if (!placement || entry?.kind !== 'npc') return null;
    const base = worldNpcOf(entry, world);
    return {
      entry,
      name: placement.name ?? entry.name,
      sheet: normalizeSheet(placement.sheet ?? (base ? npcSheetOf(base) : entry.sheet)),
      bars: placement.bars ?? world.tokenOf(entry).bars,
      spend: (bars) => ({ type: 'updatePlacement', payload: { placementId, patch: { bars } } }),
    };
  }
  const entry = state.entries.find((e) => e.id === sheetId);
  if (entry?.kind !== 'character' && entry?.kind !== 'npc') return null;
  const base = worldNpcOf(entry, world);
  if (base) return { entry, name: base.name, sheet: npcSheetOf(base), bars: npcTokenOf(base).bars, spend: null, worldNpc: base };
  const token = entry.token;
  return {
    entry,
    name: entry.name,
    sheet: normalizeSheet(entry.sheet),
    bars: token?.bars ?? [],
    spend: token ? (bars) => ({ type: 'updateEntry', payload: { entryId: entry.id, patch: { token: { ...token, bars } } } }) : null,
    ...(entry.kind === 'character' && { saveSheet: (sheet: CharacterSheet) => ({ type: 'updateEntry' as const, payload: { entryId: entry.id, patch: { sheet } } }) }),
  };
}

/** NPC do bestiário de uma entrada-referência (ficha e token moram no mundo). */
function worldNpcOf(entry: TableEntry, world: WorldView): WorldItem | undefined {
  const base = entry.worldNpcId ? world.item(entry.worldNpcId) : undefined;
  return base?.type === 'npc' ? base : undefined;
}

/** Níveis que valem nesta rolagem: tags e defeitos dos temas + etiquetas dos itens equipados. */
function levelsOf(sheet: CharacterSheet | undefined, state: TableState, world: WorldView): Map<string, number> {
  if (!sheet) return new Map();
  const themeTags = sheet.themes.flatMap((t) => [...t.tags, ...t.flaws]);
  const tableItems = new Map((state.items ?? []).map((i) => [i.id, i]));
  const own = { get: (id: string) => (world.item(id)?.type === 'item' ? world.item(id) : undefined) };
  const items = equippedTagLevels(sheet.inventory, { own, table: tableItems });
  return new Map<string, number>([...themeTags.map((t): [string, number] => [t.id, t.level]), ...items]);
}

export function performRoll(
  state: TableState,
  request: RollRequest,
  viewer: Viewer & { userId: string },
  userName: string,
  now: number,
  messageId: string,
  random: () => number = cryptoRandom,
  world: WorldView = emptyWorld(),
): RollOutcomeResult {
  const source = request.sheetId ? sheetSource(state, request.sheetId, world) : null;
  if (request.sheetId && !source) return { ok: false, reason: 'Ficha não encontrada.' };
  if (source && !canEditEntry(state, source.entry, viewer)) return { ok: false, reason: 'Você não pode rolar por esta ficha.' };

  // Níveis atuais (defeitos já são negativos) e tags mágicas
  const levels = levelsOf(source?.sheet, state, world);
  const magic = new Set((source?.sheet.themes ?? []).flatMap((t) => t.tags.filter((tag) => tag.magic).map((tag) => tag.id)));
  const effective = withPowers(request.roll, levels, magic);
  const cost = manaCost(request.roll, effective, magic);

  const commands: TableCommand[] = [];
  let worldChange: { item: WorldItem; token: TokenSettings } | undefined;
  if (cost > 0) {
    const mana = source?.bars.find((b) => b.id === MANA_BAR);
    if (!source || !mana || (!source.spend && !source.worldNpc)) return { ok: false, reason: 'Esta ficha não tem Espírito para gastar.' };
    if (mana.value < cost) return { ok: false, reason: `Espírito insuficiente (precisa de ${cost}).` };
    const bars = source.bars.map((b) => (b.id === MANA_BAR ? { ...b, value: Math.max(0, b.value - cost) } : b));
    if (source.spend) commands.push(source.spend(bars));
    else if (source.worldNpc) worldChange = { item: source.worldNpc, token: { ...npcTokenOf(source.worldNpc), bars } };
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

  // Estudos e Treinos: acumulam SA conforme o resultado (3d6 não treina)
  const studyIds = new Set([...(request.roll.attributes ?? []).map(baseTagId), ...(request.studies ?? [])]);
  const gain = studyGain(result.total, result.outcome);
  if (source?.saveSheet && gain) {
    const levelUps: string[] = [];
    const studies = source.sheet.studies.map((study) => {
      if (!studyIds.has(study.id) || !study.text.trim()) return study;
      const trained = trainStudy(study, gain);
      if (trained.leveledUp) levelUps.push(study.text.trim());
      return trained.study;
    });
    if (studies.some((s, i) => s !== source.sheet.studies[i])) commands.push(source.saveSheet({ ...source.sheet, studies }));
    if (levelUps.length) {
      const text = levelUpText(levelUps);
      commands.push({ type: 'addChatMessage', payload: { message: { id: `${messageId}-nivel`, at: now, userId: viewer.userId, author: source.name, role: viewer.role, text } } });
    }
  }
  return { ok: true, message, commands, ...(worldChange && { world: worldChange }) };
}
