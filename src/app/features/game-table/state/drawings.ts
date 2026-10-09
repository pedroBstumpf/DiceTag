import { Stroke, TableState } from '../../../core/models/table-session.model';
import { mapScene } from './helpers';

/** Comandos dos desenhos (pincel) de uma cena. A pilha de desfazer fica na sessão. */

/** Traço apagado e a posição que ele ocupava (para desfazer na mesma ordem de sobreposição). */
export interface RemovedStroke {
  stroke: Stroke;
  index: number;
}

/** Traços de `drawings` que `ids` apagaria, com as posições (vazio = nada a apagar). */
export function strokesToErase(drawings: readonly Stroke[], ids: readonly string[]): RemovedStroke[] {
  const remove = new Set(ids);
  return drawings.flatMap((stroke, index) => (remove.has(stroke.id) ? [{ stroke, index }] : []));
}

export function addStroke(state: TableState, p: { sceneId: string; stroke: Stroke }): TableState {
  return mapScene(state, p.sceneId, (sc) => ({ ...sc, drawings: [...(sc.drawings ?? []), p.stroke] }));
}

export function eraseStrokes(state: TableState, p: { sceneId: string; strokeIds: string[] }): TableState {
  const remove = new Set(p.strokeIds);
  return mapScene(state, p.sceneId, (sc) => ({ ...sc, drawings: (sc.drawings ?? []).filter((s) => !remove.has(s.id)) }));
}

/** Recoloca traços apagados nas posições originais (desfazer a borracha). */
export function restoreStrokes(state: TableState, p: { sceneId: string; removed: RemovedStroke[] }): TableState {
  return mapScene(state, p.sceneId, (sc) => {
    const drawings = [...(sc.drawings ?? [])];
    for (const { stroke, index } of p.removed) drawings.splice(Math.min(index, drawings.length), 0, stroke);
    return { ...sc, drawings };
  });
}
