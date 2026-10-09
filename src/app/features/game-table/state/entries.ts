import { TableEntry, TableState } from '../../../core/models/table-session.model';
import { clamp01 } from './helpers';

/** Comandos dos arquivos da mesa (fichas, NPCs, sons, automações) e do volume mestre. */

export function addEntry(state: TableState, { entry }: { entry: TableEntry }): TableState {
  return { ...state, entries: [...state.entries, entry] };
}

export function updateEntry(
  state: TableState,
  p: { entryId: string; patch: Partial<Omit<TableEntry, 'id' | 'kind'>> },
): TableState {
  return { ...state, entries: state.entries.map((e) => (e.id === p.entryId ? { ...e, ...p.patch } : e)) };
}

/** Exclui o arquivo, as ações dele e os tokens dele em todas as cenas. */
export function removeEntry(state: TableState, { entryId }: { entryId: string }): TableState {
  return {
    ...state,
    entries: state.entries.filter((e) => e.id !== entryId && e.ownerEntryId !== entryId),
    scenes: state.scenes.map((sc) =>
      sc.tokens?.some((t) => t.entryId === entryId) ? { ...sc, tokens: sc.tokens.filter((t) => t.entryId !== entryId) } : sc,
    ),
  };
}

/** Volume mestre dos sons (0–1). */
export function setSoundMaster(state: TableState, { volume }: { volume: number }): TableState {
  return { ...state, soundMaster: clamp01(volume) };
}
