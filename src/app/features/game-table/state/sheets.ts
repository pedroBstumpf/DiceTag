import {
  CharacterSheet,
  TableState,
  TokenBar,
  defaultToken,
  hasSheet,
  normalizeSheet,
  withStatusBars,
} from '../../../core/models/table-session.model';
import { findPlacement, mapPlacement, tokenSheetPlacement } from './helpers';

/**
 * Ficha gravada por campo (SPEC §1): o comando leva só os campos alterados, e quem aplica (o
 * navegador ou o servidor) junta com a ficha ATUAL. Duas pessoas mexendo em partes diferentes da
 * mesma ficha (uma no inventário, outra nos temas) não apagam mais a alteração uma da outra.
 *
 * `null` num campo = apagar o campo (ex.: tirar a raça escolhida): `undefined` some no JSON e
 * não chegaria ao servidor.
 */

/** Campos alterados da ficha; `null` = campo apagado. */
export type SheetPatch = { [K in keyof CharacterSheet]?: CharacterSheet[K] | null };

/** Patch pronto para enviar: `undefined` (campo apagado na tela) vira `null`. */
export function sheetPatchOf(patch: Partial<CharacterSheet>): SheetPatch {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) out[key] = value === undefined ? null : value;
  return out as SheetPatch;
}

/** Ficha com os campos do patch aplicados (`null` apaga o campo). */
export function applySheetPatch(sheet: CharacterSheet, patch: SheetPatch): CharacterSheet {
  const next: Record<string, unknown> = { ...sheet };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else if (value !== undefined) next[key] = value;
  }
  return next as unknown as CharacterSheet;
}

/**
 * Altera só os campos enviados de uma ficha: personagem ou NPC da mesa (`sheetId` = id da entrada)
 * ou a cópia de um token de NPC (`npc:<id do token>`). `bars` vem só do servidor, quando a raça
 * escolhida muda o máximo das barras de status.
 *
 * NPC-referência guarda a ficha no bestiário (o serviço grava lá, não aqui). Token de NPC que
 * ainda não tem ficha própria (antigo) recebe a primeira cópia inteira pelo `updatePlacement`:
 * este comando não tem a ficha do bestiário para copiar. Nos dois casos: estado igual.
 */
export function patchSheet(state: TableState, p: { sheetId: string; patch: SheetPatch; bars?: TokenBar[] }): TableState {
  if (!Object.keys(p.patch).length && !p.bars) return state;
  const placementId = tokenSheetPlacement(p.sheetId);
  if (placementId) {
    if (!findPlacement(state.scenes, placementId)?.sheet) return state;
    return mapPlacement(state, placementId, (t) => ({
      ...t,
      sheet: applySheetPatch(normalizeSheet(t.sheet), p.patch),
      ...(p.bars && { bars: withStatusBars(p.bars) }),
    }));
  }
  const entry = state.entries.find((e) => e.id === p.sheetId);
  if (!entry || !hasSheet(entry.kind)) return state;
  return {
    ...state,
    entries: state.entries.map((e) =>
      e.id === p.sheetId
        ? {
            ...e,
            sheet: applySheetPatch(normalizeSheet(e.sheet), p.patch),
            ...(p.bars && { token: { ...(e.token ?? defaultToken(e.kind)), bars: withStatusBars(p.bars) } }),
          }
        : e,
    ),
  };
}
