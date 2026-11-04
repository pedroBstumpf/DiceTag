import {
  STATUS_BARS,
  applyRace,
  canEditStatusMax,
  canSeeLoreItem,
  controlsNpc,
  npcSheetOf,
  npcTokenOf,
  raceTraitsOf,
  withStatusBars,
  type CharacterSheet,
  type CharacterStudy,
  type InventoryEntry,
  type RaceChoice,
  type TokenBar,
  type TokenSettings,
  type WorldItem,
} from '../domain';
import type { RuleContext, RuleResult } from './command-rules';
import type { SheetInput } from './command-schemas';
import type { WorldView } from './world';

/**
 * Fichas editadas por JOGADORES (o mestre edita tudo e não passa por aqui).
 *
 * O cliente grava a ficha inteira (comandos por campo ficam para a ligação do front, SPEC.md §1),
 * então o servidor compara com a gravada e não confia no que só ele ou o mestre definem:
 * - raça: o cliente só escolhe a referência; o servidor aplica a Raça do mundo (`applyRace`, a
 *   mesma função do front) e grava nomes, rótulos, `appliedRaces` e máximos das barras;
 * - SN dos estudos e máximo das barras de status: só o mestre (`canEditStatusMax`); as três
 *   barras de status não podem sumir (voltariam cheias, em 24/24);
 * - item novo no inventário: do mundo, só se a conta pode vê-lo (pasta revelada); da mesa, só se existe.
 * Os limites de cada campo (níveis, tamanhos) já vêm do esquema (`command-schemas.ts`).
 */

/** Ficha e barras gravadas antes da alteração. */
export interface SheetBefore {
  sheet: CharacterSheet;
  bars: TokenBar[];
}

/** Ficha e/ou barras a gravar (`bars` também quando a troca de raça mudou os máximos). */
export interface SheetChange {
  sheet?: SheetInput;
  bars?: TokenBar[];
}

const RACE_SLOTS = ['race', 'subrace'] as const;
const deny = (reason: string): RuleResult<SheetChange> => ({ ok: false, reason });

export function playerSheetChange(ctx: RuleContext, before: SheetBefore, next: SheetChange): RuleResult<SheetChange> {
  let bars = before.bars;
  let sheet = next.sheet;

  if (next.sheet) {
    const prev = before.sheet;
    const incoming = next.sheet;
    if (studyGoalChanged(prev.studies, incoming.studies ?? [])) return deny('Só o mestre define o SN dos estudos.');
    if (!newItemsAllowed(ctx, prev.inventory, incoming.inventory ?? [])) return deny('Item não encontrado.');

    // Raça: vale a gravada; trocar a referência faz o servidor aplicar a Raça do mundo
    let race: SheetInput = {
      race: prev.race,
      subrace: prev.subrace,
      raceRef: prev.raceRef,
      subraceRef: prev.subraceRef,
      appliedRaces: prev.appliedRaces,
    };
    let current: Pick<CharacterSheet, 'labels' | 'appliedRaces'> = { labels: prev.labels, appliedRaces: prev.appliedRaces };
    let raceChanged = false;
    for (const slot of RACE_SLOTS) {
      const field = slot === 'race' ? 'raceRef' : 'subraceRef';
      const wanted = incoming[field]?.id;
      if (wanted === prev[field]?.id) continue;
      const choice = wanted ? raceChoice(ctx.world, wanted) : null;
      if (wanted && !choice) return deny('Raça não encontrada.');
      // Parte da ficha gravada: rótulos digitados no mesmo envio são ignorados (a tela não faz isso)
      const result = applyRace(current, bars, slot, choice);
      race = { ...race, ...result.sheet };
      current = { labels: result.sheet.labels ?? current.labels, appliedRaces: result.sheet.appliedRaces };
      bars = result.bars;
      raceChanged = true;
    }
    sheet = { ...incoming, ...race, labels: raceChanged ? current.labels : (incoming.labels ?? prev.labels) };
  }

  if (next.bars) {
    if (!STATUS_BARS.every((s) => next.bars!.some((b) => b.id === s.id))) return deny('As barras de status não podem ser removidas.');
    if (!canEditStatusMax(ctx.viewer) && statusMaxChanged(bars, next.bars)) return deny('Só o mestre altera o máximo das barras de status.');
    bars = next.bars;
  }
  return { ok: true, payload: { ...(sheet && { sheet }), ...(bars !== before.bars && { bars }) } };
}

/** Raça do mundo pronta para `applyRace` (null se não existe ou não é uma Raça). */
function raceChoice(world: WorldView, raceId: string): RaceChoice | null {
  const item = world.item(raceId);
  if (item?.type !== 'race') return null;
  return { ref: { id: item.id }, name: item.name, traits: raceTraitsOf(item), statusMods: item.statusMods };
}

/** O SN (sucessos necessários) de algum estudo mudou? Só o mestre o define. */
function studyGoalChanged(before: readonly CharacterStudy[], next: readonly CharacterStudy[]): boolean {
  const sn = new Map(before.map((s) => [s.id, s.sn]));
  return next.some((s) => (sn.get(s.id) ?? 0) !== s.sn);
}

/** Algum máximo das barras de status difere do esperado? */
function statusMaxChanged(expected: readonly TokenBar[], next: readonly TokenBar[]): boolean {
  const want = withStatusBars([...expected]);
  return STATUS_BARS.some((s) => next.find((b) => b.id === s.id)?.max !== want.find((b) => b.id === s.id)?.max);
}

/**
 * Itens que entram no inventário (linha nova ou que trocou de original): do mundo, só os que a
 * conta pode ver na aba Lore; da mesa, só os que existem. Os que já estavam ficam como estão.
 */
function newItemsAllowed(ctx: RuleContext, before: readonly InventoryEntry[], next: readonly InventoryEntry[]): boolean {
  const old = new Map(before.map((i) => [i.id, i]));
  const revealed = new Set(ctx.state.lore?.revealed ?? []);
  const parentOf = (id: string) => ctx.world.parentOf(id);
  return next.every((entry) => {
    const was = old.get(entry.id);
    if (was && was.itemId === entry.itemId && !!was.table === !!entry.table) return true;
    if (entry.table) return (ctx.state.items ?? []).some((i) => i.id === entry.itemId);
    return ctx.world.item(entry.itemId)?.type === 'item' && canSeeLoreItem(revealed, parentOf, entry.itemId, false, ctx.viewer);
  });
}

/** Alteração pedida por quem controla um NPC do bestiário (o resto do item é do mestre). */
export interface ControlledNpcPatch {
  sheet?: SheetInput;
  bars?: TokenBar[];
  tags?: TokenSettings['tags'];
  abilities?: WorldItem['abilities'];
}

/**
 * Item do mundo depois de uma alteração de quem controla o NPC: só vale para um NPC do bestiário
 * que está na mesa sob o controle da conta. Ficha e barras passam pelas mesmas regras do jogador
 * (raça, SN, máximo das barras, itens); nome, imagem, pasta e o resto não mudam por aqui.
 */
export function controlledNpcChange(ctx: RuleContext, npc: WorldItem, patch: ControlledNpcPatch): RuleResult<WorldItem> {
  if (!ctx.state.entries.some((e) => e.worldNpcId === npc.id && controlsNpc(e, ctx.viewer))) return { ok: false, reason: 'Você não controla este NPC.' };
  const token = npcTokenOf(npc);
  const change = playerSheetChange(ctx, { sheet: npcSheetOf(npc), bars: token.bars }, { sheet: patch.sheet, bars: patch.bars });
  if (!change.ok) return change;
  return {
    ok: true,
    payload: {
      ...npc,
      ...(change.payload.sheet && { sheet: change.payload.sheet as CharacterSheet }),
      token: { ...token, ...(change.payload.bars && { bars: change.payload.bars }), ...(patch.tags && { tags: patch.tags }) },
      ...(patch.abilities && { abilities: patch.abilities }),
    },
  };
}
