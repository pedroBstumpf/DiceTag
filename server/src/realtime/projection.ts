import {
  canSeeLoreItem,
  controlsNpc,
  doorSeen,
  isDown,
  isPointVisible,
  levelOf,
  ownsCharacter,
  visibleDoorsFor,
  visibleDropsFor,
  visibleNotesFor,
  visibleTokensFor,
  worldItemRefs,
  raceTraitsOf,
  type CharacterSheet,
  type DoorWall,
  type Scene,
  type TableEntry,
  type TableState,
  type TokenPlacement,
  type Viewer,
  type WorldItem,
} from '../domain';
import { canEditEntry } from './command-rules';
import type { TableEvent } from './protocol';
import type { PlayerScene } from './vision';

/**
 * Projeção do estado por quem olha (SPEC.md §3.1, BACKEND_SECURITY.md §4.3): o servidor envia a
 * cada jogador só o que ele pode ver. Esconder na tela não basta — o jogador pode ler os dados
 * recebidos no navegador. As regras de visibilidade são as do front-end (`state/player-view.ts`).
 *
 * O jogador recebe só a cena aberta (sem as pastas de cenas) e, nela:
 * - tokens: os que algum token enxerga agora (personagens sempre); a ficha de token de NPC só se
 *   liberada (inteira ou só o inventário; inventário de token derrotado sempre);
 * - paredes: com névoa, NENHUMA (revelariam a planta do mapa), só as portas vistas ou exploradas,
 *   e os polígonos de visão vão à parte (`vision` na mensagem); sem névoa, as da camada dele;
 * - anotações públicas vistas ou exploradas; itens no chão e efeitos fixos visíveis, da camada dele.
 *
 * E, das fichas: personagens (sem as anotações pessoais dos outros), NPCs que controla ou cujo
 * token está à vista (sem a ficha base), e só as ações dele. Sons: só os que estão tocando, sem o
 * nome (o nome da faixa pode entregar o que vem por aí); o resto da aba Sons é do mestre.
 */
export function projectState(state: TableState, viewer: Viewer, view: PlayerScene | null): TableState {
  if (viewer.role === 'gm') return state;
  const scene = view ? projectScene(view, viewer) : null;
  const onMap = new Set(scene?.tokens?.map((t) => t.entryId));
  return {
    ...state,
    sceneFolders: [],
    scenes: scene ? [scene] : [],
    entries: state.entries.filter((e) => entryVisible(e, state, viewer, onMap)).map((e) => projectEntry(e, viewer)),
  };
}

/** Polígonos de visão enviados ao jogador (null = sem névoa: ele vê o mapa todo). */
export function playerVision(viewer: Viewer, view: PlayerScene | null): PlayerScene['fog']['polygons'] | null {
  return viewer.role !== 'gm' && view?.fog.enabled ? view.fog.polygons : null;
}

/**
 * Evento efêmero (ping, efeito) que a conta pode receber: o jogador só os da cena aberta e, com
 * névoa, efeitos que começam ou terminam numa área visível da camada dele. Pings sempre: são um
 * aviso intencional de quem marcou.
 */
export function eventVisibleTo(event: TableEvent, viewer: Viewer, view: PlayerScene | null): boolean {
  if (viewer.role === 'gm') return true;
  if (!view || event.sceneId !== view.scene.id) return false;
  if (event.kind === 'ping') return true;
  const { fx } = event;
  return levelOf(fx) === view.level && (isPointVisible(fx.from, view.fog) || isPointVisible(fx.to, view.fog));
}

// --- Cena ------------------------------------------------------------------------

function projectScene({ scene, level, tokens, fog }: PlayerScene, viewer: Viewer): Scene {
  const levelWalls = (scene.walls ?? []).filter((w) => levelOf(w) === level);
  const doors = levelWalls.filter((w): w is DoorWall => w.kind === 'door');
  return {
    ...scene,
    tokens: visibleTokensFor(tokens, 'player', fog).map((t) => projectPlacement(t.placement, t.entry, viewer)),
    walls: fog.enabled ? visibleDoorsFor(doors, 'player', fog, (d) => doorSeen(d.points, fog.polygons)) : levelWalls,
    notes: visibleNotesFor(scene.notes ?? [], 'player', fog),
    drops: visibleDropsFor((scene.drops ?? []).filter((d) => levelOf(d) === level), 'player', fog),
    effects: (scene.effects ?? []).filter((fx) => levelOf(fx) === level && (isPointVisible(fx.from, fog) || isPointVisible(fx.to, fog))),
  };
}

/** Token de NPC: a ficha própria só se liberada (inteira ou só o inventário). */
function projectPlacement(placement: TokenPlacement, entry: TableEntry, viewer: Viewer): TokenPlacement {
  if (!placement.sheet || entry.kind !== 'npc' || controlsNpc(entry, viewer) || placement.sheetPublic) return placement;
  const { sheet, ...rest } = placement;
  const bars = placement.bars ?? entry.token?.bars ?? [];
  if (placement.inventoryPublic || isDown(bars)) return { ...rest, sheet: { inventory: sheet.inventory } as CharacterSheet };
  return rest;
}

// --- Fichas ------------------------------------------------------------------------

function entryVisible(entry: TableEntry, state: TableState, viewer: Viewer, onMap: ReadonlySet<string>): boolean {
  switch (entry.kind) {
    case 'character':
      return true;
    case 'npc':
      return controlsNpc(entry, viewer) || onMap.has(entry.id);
    case 'automation':
      // Só as ações dele (personagem ou NPC que controla); as gerais e as de NPCs são do mestre
      return !!entry.ownerEntryId && canEditEntry(state, entry, viewer);
    case 'sound':
      // A aba Sons é do mestre; o jogador recebe só o que precisa para ouvir o que está tocando
      return (state.playing ?? []).some((p) => p.entryId === entry.id);
    default:
      return false;
  }
}

function projectEntry(entry: TableEntry, viewer: Viewer): TableEntry {
  if (entry.kind === 'sound') {
    const { id, kind, createdAt, blobId, volume, loop } = entry;
    return { id, kind, createdAt, name: '', blobId, volume, loop };
  }
  if (entry.kind === 'npc' && !controlsNpc(entry, viewer)) {
    const { sheet: _sheet, ...rest } = entry;
    return rest;
  }
  if (entry.kind === 'character' && entry.sheet && !ownsCharacter(entry, viewer)) {
    return { ...entry, sheet: { ...entry.sheet, notes: [] } };
  }
  return entry;
}

// --- Lore ----------------------------------------------------------------------------

/**
 * Itens do mundo da mesa que a conta pode ver (aba Lore):
 * - mestre: todos;
 * - jogador: os que estão em pastas reveladas nesta mesa (`canSeeLoreItem`) + o mínimo do que a
 *   mesa mostra a ele, sempre fora da árvore (`parentId: null`, a aba Lore não os lista):
 *   - NPCs do bestiário que ele vê (nome e token, para desenhar os tokens), sem a ficha base;
 *   - Raças (ele escolhe a do personagem na ficha): nome, características e modificadores;
 *   - cartão dos itens citados nos inventários e no chão que ele vê.
 *
 * `state` é o estado JÁ PROJETADO para a conta: só os NPCs que ela vê ou controla entram.
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
  const summary = (i: WorldItem) => ({ id: i.id, type: i.type, name: i.name, parentId: null, createdAt: i.createdAt, updatedAt: i.updatedAt });
  for (const race of items) {
    if (race.type !== 'race' || seen.has(race.id)) continue;
    seen.add(race.id);
    visible.push({ ...summary(race), traits: raceTraitsOf(race), statusMods: race.statusMods });
  }
  // Itens: os do estado projetado e os do inventário dos NPCs do bestiário que a conta controla
  const controlled = state.entries.filter((e) => controlsNpc(e, viewer)).flatMap((e) => byId.get(e.worldNpcId ?? '')?.sheet?.inventory ?? []);
  for (const id of [...worldItemRefs(state), ...controlled.filter((i) => !i.table).map((i) => i.itemId)]) {
    const item = byId.get(id);
    if (item?.type !== 'item' || seen.has(id)) continue;
    seen.add(id);
    visible.push({ ...summary(item), tags: item.tags, description: item.description, blobId: item.blobId });
  }
  return visible;
}
