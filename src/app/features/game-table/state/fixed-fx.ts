import { FixedFx, TableState } from '../../../core/models/table-session.model';
import { mapScene } from './helpers';

/**
 * Efeitos especiais fixos no mapa: comandos puros para fixar, tirar um e tirar todos da cena.
 * (O desenho é montado na tela por `buildFx`; aqui ficam só os dados do lançamento.)
 */

export function addFixedFx(state: TableState, p: { sceneId: string; fx: FixedFx }): TableState {
  return mapScene(state, p.sceneId, (sc) => ({ ...sc, effects: [...(sc.effects ?? []), p.fx] }));
}

export function removeFixedFx(state: TableState, p: { sceneId: string; fxId: string }): TableState {
  return mapScene(state, p.sceneId, (sc) =>
    sc.effects?.some((f) => f.id === p.fxId) ? { ...sc, effects: sc.effects.filter((f) => f.id !== p.fxId) } : sc,
  );
}

/** Tira os efeitos fixos da cena (`fxIds` = só estes; ausente = todos). */
export function clearFixedFx(state: TableState, p: { sceneId: string; fxIds?: string[] }): TableState {
  return mapScene(state, p.sceneId, (sc) => {
    if (!sc.effects?.length) return sc;
    const ids = p.fxIds && new Set(p.fxIds);
    return { ...sc, effects: ids ? sc.effects.filter((f) => !ids.has(f.id)) : [] };
  });
}
