import { MapNote, TableState } from '../../../core/models/table-session.model';
import { mapScene } from './helpers';

/** Comandos das anotações (marcadores) no mapa de uma cena. */

export function addNote(state: TableState, p: { sceneId: string; note: MapNote }): TableState {
  return mapScene(state, p.sceneId, (sc) => ({ ...sc, notes: [...(sc.notes ?? []), p.note] }));
}

export function updateNote(
  state: TableState,
  p: { sceneId: string; noteId: string; patch: Partial<Omit<MapNote, 'id'>> },
): TableState {
  return mapScene(state, p.sceneId, (sc) => ({
    ...sc,
    notes: (sc.notes ?? []).map((n) => (n.id === p.noteId ? { ...n, ...p.patch } : n)),
  }));
}

export function removeNote(state: TableState, p: { sceneId: string; noteId: string }): TableState {
  return mapScene(state, p.sceneId, (sc) => ({ ...sc, notes: (sc.notes ?? []).filter((n) => n.id !== p.noteId) }));
}
