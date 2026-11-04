import { TableEntry, TableState } from '../../../core/models/table-session.model';
import { NoPayload, clamp01 } from './helpers';

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
    ...(state.playing?.some((p) => p.entryId === entryId) && { playing: state.playing.filter((p) => p.entryId !== entryId) }),
    scenes: state.scenes.map((sc) =>
      sc.tokens?.some((t) => t.entryId === entryId) ? { ...sc, tokens: sc.tokens.filter((t) => t.entryId !== entryId) } : sc,
    ),
  };
}

/** Volume mestre dos sons (0–1). */
export function setSoundMaster(state: TableState, { volume }: { volume: number }): TableState {
  return { ...state, soundMaster: clamp01(volume) };
}

/**
 * Mesa online: toca ou para um som para todos. `startedAt` (carimbado pelo servidor) é o que faz
 * quem entra depois ouvir o mesmo ponto da faixa. Tocar de novo recomeça do início.
 */
export function setSoundPlaying(state: TableState, p: { entryId: string; playing: boolean; startedAt: number }): TableState {
  const others = (state.playing ?? []).filter((s) => s.entryId !== p.entryId);
  if (p.playing) return { ...state, playing: [...others, { entryId: p.entryId, startedAt: p.startedAt }] };
  return others.length === (state.playing?.length ?? 0) ? state : { ...state, playing: others };
}

/** Mesa online: para todos os sons. */
export function stopAllSounds(state: TableState, _payload: NoPayload): TableState {
  return state.playing?.length ? { ...state, playing: [] } : state;
}
