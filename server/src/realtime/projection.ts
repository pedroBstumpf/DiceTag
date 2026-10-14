import {
  canSeeLoreItem,
  controlsNpc,
  isDown,
  ownsCharacter,
  type CharacterSheet,
  type Scene,
  type TableEntry,
  type TableState,
  type TokenPlacement,
  type Viewer,
  type WorldItem,
} from '../domain';
import { canEditEntry } from './command-rules';

/**
 * Projeção do estado por quem olha (SPEC.md §3.1): o servidor envia a cada jogador só o que ele
 * pode ver. Esconder na tela não basta — o jogador pode ler os dados recebidos no navegador.
 *
 * O jogador NÃO recebe:
 * - cenas que não estão abertas (o mestre prepara as próximas em segredo) nem as pastas de cenas;
 * - anotações "só mestre";
 * - a ficha de NPCs que ele não controla — de tokens, só o que o mestre liberou (ficha e/ou
 *   inventário; inventário de token derrotado sempre);
 * - ações do mestre e de NPCs que ele não controla;
 * - as anotações pessoais (aba Anotações) dos personagens de outros jogadores.
 *
 * Ainda recebe (próxima etapa, com a visão calculada no servidor — SPEC §3.1): paredes e tokens
 * sob a névoa, que o front-end usa hoje para calcular a visão localmente.
 */
export function projectState(state: TableState, viewer: Viewer): TableState {
  if (viewer.role === 'gm') return state;
  const active = state.scenes.find((s) => s.id === state.activeSceneId);
  const entryById = new Map(state.entries.map((e) => [e.id, e]));
  return {
    ...state,
    sceneFolders: [],
    scenes: active ? [projectScene(active, entryById, viewer)] : [],
    entries: state.entries.filter((e) => entryVisible(e, state, viewer)).map((e) => projectEntry(e, viewer)),
  };
}

/** Arquivos que o jogador recebe: ações só as dele (personagem/NPC que controla); sons e fichas, todos. */
function entryVisible(entry: TableEntry, state: TableState, viewer: Viewer): boolean {
  if (entry.kind !== 'automation') return true;
  return !!entry.ownerEntryId && canEditEntry(state, entry, viewer);
}

function projectEntry(entry: TableEntry, viewer: Viewer): TableEntry {
  if (entry.kind === 'npc' && !controlsNpc(entry, viewer)) {
    const { sheet: _sheet, ...rest } = entry;
    return rest;
  }
  if (entry.kind === 'character' && entry.sheet && !ownsCharacter(entry, viewer)) {
    return { ...entry, sheet: { ...entry.sheet, notes: [] } };
  }
  return entry;
}

function projectScene(scene: Scene, entryById: ReadonlyMap<string, TableEntry>, viewer: Viewer): Scene {
  return {
    ...scene,
    notes: (scene.notes ?? []).filter((n) => !n.gmOnly),
    tokens: (scene.tokens ?? []).map((t) => projectPlacement(t, entryById.get(t.entryId), viewer)),
  };
}

/** Token de NPC: a ficha própria só se liberada (inteira ou só o inventário). */
function projectPlacement(placement: TokenPlacement, entry: TableEntry | undefined, viewer: Viewer): TokenPlacement {
  if (!placement.sheet || entry?.kind !== 'npc' || controlsNpc(entry, viewer) || placement.sheetPublic) return placement;
  const { sheet, ...rest } = placement;
  const bars = placement.bars ?? entry.token?.bars ?? [];
  if (placement.inventoryPublic || isDown(bars)) return { ...rest, sheet: { inventory: sheet.inventory } as CharacterSheet };
  return rest;
}

/**
 * Itens do mundo da mesa que a conta pode ver (aba Lore):
 * - mestre: todos;
 * - jogador: os que estão em pastas reveladas nesta mesa (`canSeeLoreItem`) + o mínimo dos NPCs
 *   do bestiário que estão na mesa (nome e token, para desenhar os tokens), sem a ficha base.
 */
export function projectLore(items: readonly WorldItem[], state: TableState, viewer: Viewer): WorldItem[] {
  if (viewer.role === 'gm') return [...items];
  const revealed = new Set(state.lore?.revealed ?? []);
  const byId = new Map(items.map((i) => [i.id, i]));
  const parentOf = (id: string) => byId.get(id)?.parentId;
  const visible = items.filter((i) => canSeeLoreItem(revealed, parentOf, i.id, false, viewer));
  const seen = new Set(visible.map((i) => i.id));
  for (const entry of state.entries) {
    const npc = entry.worldNpcId ? byId.get(entry.worldNpcId) : undefined;
    if (!npc || seen.has(npc.id)) continue;
    seen.add(npc.id);
    // Quem controla o NPC edita a ficha base dele: recebe o item inteiro
    if (controlsNpc(entry, viewer)) visible.push({ ...npc, parentId: null });
    else visible.push({ id: npc.id, type: 'npc', name: npc.name, parentId: null, createdAt: npc.createdAt, updatedAt: npc.updatedAt, token: npc.token });
  }
  return visible;
}
