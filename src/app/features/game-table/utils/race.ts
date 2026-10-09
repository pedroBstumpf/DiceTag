import {
  AppliedRace,
  CharacterSheet,
  RaceRef,
  RaceSlot,
  STATUS_BARS,
  StatusMods,
  TokenBar,
} from '../../../core/models/table-session.model';

/**
 * Raça na ficha — funções puras, sem Angular.
 *
 * Escolher uma Raça (na raça ou na sub-raça) soma as características dela aos rótulos do personagem
 * e os modificadores ao máximo das barras de status. A ficha guarda o que cada campo aplicou
 * (`appliedRaces`) para, ao trocar ou limpar, desfazer só aquilo: rótulos digitados à mão e o
 * que o outro campo aplicou ficam.
 */

/** Raça escolhida, com o que ela aplica (características = texto, viram rótulos). */
export interface RaceChoice {
  ref: RaceRef;
  name: string;
  traits: readonly string[];
  statusMods?: StatusMods;
}

/** Chave de uma raça na lista: o id. */
export function raceKey(ref: RaceRef | undefined): string {
  return ref?.id ?? '';
}

/** Máximo nunca abaixo de 1. */
const MIN_MAX = 1;

/**
 * Aplica (ou, com `choice` null, limpa) a raça de um campo da ficha.
 * Devolve o patch da ficha e as barras com os máximos ajustados: desfaz o que a raça anterior
 * daquele campo tinha aplicado e aplica a nova. O valor atual da barra acompanha a mudança do
 * máximo (um personagem cheio continua cheio), sempre entre 0 e o máximo.
 */
export function applyRace(
  sheet: Pick<CharacterSheet, 'labels' | 'appliedRaces'>,
  bars: readonly TokenBar[],
  slot: RaceSlot,
  choice: RaceChoice | null,
): { sheet: Partial<CharacterSheet>; bars: TokenBar[] } {
  const previous = sheet.appliedRaces?.[slot];

  // Rótulos: tira os que a raça anterior acrescentou e soma os novos (sem repetir)
  const kept = sheet.labels.filter((l) => !previous?.labels.includes(l));
  const added = [...new Set((choice?.traits ?? []).map((t) => t.trim()).filter((t) => t && !kept.includes(t)))];

  // Modificadores: desconta os anteriores e soma os novos
  const mods: StatusMods = { ...choice?.statusMods };
  const nextBars = bars.map((bar) => {
    const status = STATUS_BARS.find((s) => s.id === bar.id);
    if (!status) return bar;
    const delta = (mods[status.id] ?? 0) - (previous?.mods[status.id] ?? 0);
    if (!delta) return bar;
    const max = Math.max(MIN_MAX, bar.max + delta);
    return { ...bar, max, value: Math.min(max, Math.max(0, bar.value + delta)) };
  });

  const applied: AppliedRace | undefined = choice ? { labels: added, mods } : undefined;
  const appliedRaces = { ...sheet.appliedRaces, [slot]: applied };
  if (!applied) delete appliedRaces[slot];
  const refField = slot === 'race' ? 'raceRef' : 'subraceRef';
  return {
    sheet: { [slot]: choice?.name ?? '', [refField]: choice?.ref, labels: [...kept, ...added], appliedRaces },
    bars: nextBars,
  };
}
