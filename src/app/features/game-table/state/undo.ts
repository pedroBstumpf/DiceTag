import { Scene, TableState } from '../../../core/models/table-session.model';
import { TableCommand, applyCommand } from './commands';
import { strokesToErase } from './drawings';
import { findDrop } from './drops';
import { findPlacement } from './helpers';

/**
 * Desfazer e refazer na mesa (Ctrl+Z / Ctrl+Y) — funções puras, sem Angular.
 *
 * Cada ação do mapa guarda o COMANDO QUE A DESFAZ, calculado com o estado de antes. Desfazer é só
 * enviar esse comando: na mesa online ele passa pelas mesmas regras do servidor que qualquer outro
 * (ninguém desfaz o que não poderia fazer). São usados só comandos que já existem.
 *
 * Cobre o que se faz no mapa: tokens (colocar, mover, tamanho/camada/opções, tirar), paredes e
 * portas, desenhos, anotações, itens no chão e efeitos fixos. Ficam de fora: rolagens, chat,
 * compras e transferências, fichas, cenas e camadas, e remoções que apagam imagens (um token de
 * NPC ou item no chão com imagem própria): a imagem já foi apagada e não volta.
 */

/** Uma ação desfazível: os comandos que a desfazem (aplicados em ordem) e quando aconteceu. */
export interface UndoEntry {
  commands: TableCommand[];
  /** Gesto contínuo (arrastar, WASD): ações seguidas com a mesma chave viram uma só. */
  key: string | null;
  at: number;
}

/** Pilhas de uma cena: o que dá para desfazer e o que dá para refazer. */
export interface UndoStacks {
  done: UndoEntry[];
  undone: UndoEntry[];
}

export const EMPTY_UNDO: UndoStacks = { done: [], undone: [] };
/** Passos guardados por cena (o mais antigo sai). */
export const UNDO_LIMIT = 100;
/** Comandos com a mesma chave a menos disto um do outro são o mesmo gesto. */
export const UNDO_MERGE_MS = 800;

// --- O comando que desfaz cada ação ---------------------------------------------

/** Mesmos campos do patch, com os valores de antes (campos que não existiam ficam de fora). */
function previous<T extends object>(current: T, patch: object): Partial<T> | null {
  const out: Partial<T> = {};
  let any = false;
  for (const key of Object.keys(patch) as (keyof T)[]) {
    if (current[key] === undefined) continue;
    out[key] = current[key];
    any = true;
  }
  return any ? out : null;
}

const sceneById = (state: TableState, sceneId: string): Scene | undefined => state.scenes.find((s) => s.id === sceneId);
const one = (command: TableCommand): TableCommand[] => [command];

/**
 * Comandos que desfazem `command`, calculados com o estado ANTES dele; null se a ação não é
 * desfazível ou não mudaria nada.
 */
export function inverseOf(state: TableState, command: TableCommand): TableCommand[] | null {
  switch (command.type) {
    // --- Tokens
    case 'placeToken':
      return one({ type: 'removeToken', payload: { placementId: command.payload.placement.id } });
    case 'removeToken': {
      const scene = state.scenes.find((s) => s.tokens?.some((t) => t.id === command.payload.placementId));
      const placement = scene?.tokens?.find((t) => t.id === command.payload.placementId);
      // A cópia da ficha do NPC com imagens próprias: elas são apagadas junto
      if (!scene || !placement || placement.sheet?.inventory.some((i) => i.blobId)) return null;
      return one({ type: 'placeToken', payload: { sceneId: scene.id, placement } });
    }
    case 'moveToken': {
      const t = findPlacement(state.scenes, command.payload.placementId);
      if (!t || (t.x === command.payload.x && t.y === command.payload.y)) return null;
      return one({ type: 'moveToken', payload: { placementId: t.id, x: t.x, y: t.y } });
    }
    case 'moveTokens': {
      const moves = command.payload.moves.flatMap((m) => {
        const t = findPlacement(state.scenes, m.placementId);
        return t ? [{ placementId: t.id, x: t.x, y: t.y }] : [];
      });
      return moves.length ? one({ type: 'moveTokens', payload: { moves } }) : null;
    }
    case 'updatePlacement': {
      const t = findPlacement(state.scenes, command.payload.placementId);
      // A ficha do token é editada na janela dela (campos de texto têm o próprio Ctrl+Z)
      if (!t || 'sheet' in command.payload.patch) return null;
      const patch = previous(t, command.payload.patch);
      return patch ? one({ type: 'updatePlacement', payload: { placementId: t.id, patch } }) : null;
    }
    case 'updateEntry': {
      // Só o token da ficha (tamanho, visão, barras, etiquetas): o que se muda pelo mapa
      const entry = state.entries.find((e) => e.id === command.payload.entryId);
      const keys = Object.keys(command.payload.patch);
      if (!entry?.token || keys.length !== 1 || keys[0] !== 'token') return null;
      return one({ type: 'updateEntry', payload: { entryId: entry.id, patch: { token: entry.token } } });
    }
    case 'setTokenPublic': {
      const t = findPlacement(state.scenes, command.payload.placementId);
      if (!t) return null;
      const value = !!(command.payload.part === 'sheet' ? t.sheetPublic : t.inventoryPublic);
      return value === command.payload.value ? null : one({ type: 'setTokenPublic', payload: { ...command.payload, value } });
    }

    // --- Paredes e portas
    case 'addWall':
      return one({ type: 'removeWall', payload: { sceneId: command.payload.sceneId, wallId: command.payload.wall.id } });
    case 'removeWall': {
      const wall = sceneById(state, command.payload.sceneId)?.walls?.find((w) => w.id === command.payload.wallId);
      return wall ? one({ type: 'addWall', payload: { sceneId: command.payload.sceneId, wall } }) : null;
    }
    case 'updateWall': {
      const wall = sceneById(state, command.payload.sceneId)?.walls?.find((w) => w.id === command.payload.wall.id);
      return wall ? one({ type: 'updateWall', payload: { sceneId: command.payload.sceneId, wall } }) : null;
    }
    case 'setDoorOpen': {
      const door = sceneById(state, command.payload.sceneId)?.walls?.find((w) => w.id === command.payload.doorId);
      if (door?.kind !== 'door' || !!door.open === command.payload.open) return null;
      return one({ type: 'setDoorOpen', payload: { ...command.payload, open: !!door.open } });
    }

    // --- Desenhos
    case 'addStroke':
      return one({ type: 'eraseStrokes', payload: { sceneId: command.payload.sceneId, strokeIds: [command.payload.stroke.id] } });
    case 'eraseStrokes': {
      const removed = strokesToErase(sceneById(state, command.payload.sceneId)?.drawings ?? [], command.payload.strokeIds);
      return removed.length ? one({ type: 'restoreStrokes', payload: { sceneId: command.payload.sceneId, removed } }) : null;
    }
    case 'restoreStrokes':
      return one({
        type: 'eraseStrokes',
        payload: { sceneId: command.payload.sceneId, strokeIds: command.payload.removed.map((r) => r.stroke.id) },
      });

    // --- Anotações
    case 'addNote':
      return one({ type: 'removeNote', payload: { sceneId: command.payload.sceneId, noteId: command.payload.note.id } });
    case 'removeNote': {
      const note = sceneById(state, command.payload.sceneId)?.notes?.find((n) => n.id === command.payload.noteId);
      return note ? one({ type: 'addNote', payload: { sceneId: command.payload.sceneId, note } }) : null;
    }
    case 'updateNote': {
      const note = sceneById(state, command.payload.sceneId)?.notes?.find((n) => n.id === command.payload.noteId);
      const patch = note && previous(note, command.payload.patch);
      return patch ? one({ type: 'updateNote', payload: { ...command.payload, patch } }) : null;
    }

    // --- Itens no chão
    case 'addDrop':
      return one({ type: 'removeDrop', payload: { dropId: command.payload.drop.id } });
    case 'removeDrop': {
      const found = findDrop(state.scenes, command.payload.dropId);
      // Item com imagem própria: ela é apagada junto
      if (!found || found.drop.item.blobId) return null;
      return one({ type: 'addDrop', payload: { sceneId: found.scene.id, drop: found.drop } });
    }
    case 'moveDrop': {
      const drop = findDrop(state.scenes, command.payload.dropId)?.drop;
      if (!drop || (drop.x === command.payload.x && drop.y === command.payload.y)) return null;
      return one({ type: 'moveDrop', payload: { dropId: drop.id, x: drop.x, y: drop.y } });
    }
    case 'setDropQuantity': {
      const drop = findDrop(state.scenes, command.payload.dropId)?.drop;
      return drop ? one({ type: 'setDropQuantity', payload: { dropId: drop.id, quantity: drop.item.quantity ?? 1 } }) : null;
    }
    case 'updateDrop': {
      const drop = findDrop(state.scenes, command.payload.dropId)?.drop;
      const patch = drop && previous(drop, command.payload.patch);
      return patch ? one({ type: 'updateDrop', payload: { dropId: command.payload.dropId, patch } }) : null;
    }

    // --- Efeitos fixos
    case 'addFixedFx':
      return one({ type: 'removeFixedFx', payload: { sceneId: command.payload.sceneId, fxId: command.payload.fx.id } });
    case 'removeFixedFx': {
      const fx = sceneById(state, command.payload.sceneId)?.effects?.find((f) => f.id === command.payload.fxId);
      return fx ? one({ type: 'addFixedFx', payload: { sceneId: command.payload.sceneId, fx } }) : null;
    }
    case 'clearFixedFx': {
      const ids = command.payload.fxIds && new Set(command.payload.fxIds);
      const removed = (sceneById(state, command.payload.sceneId)?.effects ?? []).filter((f) => !ids || ids.has(f.id));
      return removed.length
        ? removed.map((fx): TableCommand => ({ type: 'addFixedFx', payload: { sceneId: command.payload.sceneId, fx } }))
        : null;
    }

    default:
      return null;
  }
}

/**
 * Comandos que desfazem uma SEQUÊNCIA aplicada a partir de `state` (cada um calculado com o estado
 * logo antes dele), na ordem em que devem ser aplicados: do último para o primeiro.
 * Usado para montar o "refazer" de um desfazer.
 */
export function inverseOfAll(state: TableState, commands: readonly TableCommand[]): TableCommand[] {
  const out: TableCommand[] = [];
  let current = state;
  for (const command of commands) {
    const inverse = inverseOf(current, command);
    if (inverse) out.unshift(...inverse);
    current = applyCommand(current, command);
  }
  return out;
}

/** Chave do gesto contínuo (arrastar um token, uma parede, uma anotação…); null = ação única. */
export function undoKey(command: TableCommand): string | null {
  switch (command.type) {
    case 'moveToken':
      return `token:${command.payload.placementId}`;
    case 'moveTokens':
      return `tokens:${command.payload.moves.map((m) => m.placementId).sort().join(',')}`;
    case 'moveDrop':
      return `drop:${command.payload.dropId}`;
    case 'updateWall':
      return `wall:${command.payload.wall.id}`;
    case 'updateNote':
      return `note:${command.payload.noteId}:${Object.keys(command.payload.patch).sort().join(',')}`;
    case 'updatePlacement':
      return `placement:${command.payload.placementId}:${Object.keys(command.payload.patch).sort().join(',')}`;
    case 'updateEntry':
      return `entry:${command.payload.entryId}`;
    case 'updateDrop':
      return `drop-style:${command.payload.dropId}`;
    default:
      return null;
  }
}

// --- Pilhas ---------------------------------------------------------------------

/**
 * Guarda uma ação nova: some o "refazer" (a história mudou) e, se for a continuação do mesmo
 * gesto (mesma chave, pouco depois), fica só a primeira — desfazer volta ao começo do arraste.
 */
export function recordUndo(stacks: UndoStacks, entry: UndoEntry): UndoStacks {
  const last = stacks.done[stacks.done.length - 1];
  if (last && entry.key && last.key === entry.key && entry.at - last.at < UNDO_MERGE_MS) {
    return { done: [...stacks.done.slice(0, -1), { ...last, at: entry.at }], undone: [] };
  }
  return { done: [...stacks.done, entry].slice(-UNDO_LIMIT), undone: [] };
}

/** Junta comandos ao passo mais recente (ações disparadas juntas: colar ou apagar vários tokens). */
export function extendLastUndo(stacks: UndoStacks, commands: TableCommand[]): UndoStacks {
  const last = stacks.done[stacks.done.length - 1];
  if (!last) return stacks;
  // Desfazer aplica do mais novo para o mais antigo
  return { ...stacks, done: [...stacks.done.slice(0, -1), { ...last, commands: [...commands, ...last.commands], key: null }] };
}
