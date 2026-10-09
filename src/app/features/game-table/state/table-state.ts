import {
  DEFAULT_SOUND_VOLUME,
  TableLore,
  TableState,
  defaultToken,
  hasSheet,
  withStatusBars,
} from '../../../core/models/table-session.model';

/** Mesa nova (ou sem dados salvos). */
export const EMPTY_STATE: TableState = { scenes: [], activeSceneId: null, entries: [] };

/** Aba Lore sem pastas nem ajustes. */
export const EMPTY_LORE: TableLore = { folders: [], items: {} };

/**
 * Completa um estado salvo com os valores padrão dos campos novos.
 * Mesas criadas em versões antigas continuam abrindo sem erro.
 */
export function normalizeState(raw: TableState | undefined): TableState {
  if (!raw) return EMPTY_STATE;
  return {
    ...raw,
    scenes: raw.scenes.map((sc) => ({
      ...sc,
      tokens: sc.tokens ?? [],
      fog: sc.fog ?? { enabled: false },
      walls: sc.walls ?? [],
      drawings: sc.drawings ?? [],
      notes: sc.notes ?? [],
    })),
    entries: raw.entries.map((e) => {
      if (e.kind === 'sound') return { ...e, volume: e.volume ?? DEFAULT_SOUND_VOLUME, loop: e.loop ?? true };
      // Personagens e NPCs sempre têm as barras de status (Corpo, Mente, Espírito) no token
      if (hasSheet(e.kind)) {
        const token = e.token ?? defaultToken(e.kind);
        return { ...e, token: { ...token, bars: withStatusBars(token.bars) } };
      }
      return e;
    }),
  };
}
