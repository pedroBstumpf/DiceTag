import {
  canEdit,
  canEditTableItem,
  canRemoveFixedFx,
  clampLevelIn,
  defaultToken,
  findDrop,
  findPlacement,
  levelOf,
  movePathBlocked,
  normalizeSheet,
  ownsCharacter,
  wallsBlockMovement,
  wallsToSegments,
  type Scene,
  type TableCommandType,
  type TableEntry,
  type TableState,
  type Viewer,
} from '../domain';
import type { ValidPayload } from './command-schemas';
import { playerSheetChange } from './sheet-rules';
import type { WorldView } from './world';

/**
 * Autorização de cada comando da mesa no servidor (SPEC.md §3.3): o navegador não é confiável,
 * então TODO comando passa por aqui antes de ser aplicado, com as mesmas regras puras do
 * front-end (`state/permissions.ts`) e algumas a mais, que só fazem sentido com várias contas.
 *
 * Cada regra recebe o payload já validado (formato) e devolve:
 * - `ok` com o payload final — às vezes "carimbado" pelo servidor (autor da mensagem, dono do
 *   efeito, horário): campos que o cliente não pode escolher;
 * - ou o motivo da recusa (mensagem curta e segura para mostrar ao usuário).
 */

// --- Tipos ---------------------------------------------------------------------

export interface RuleContext {
  state: TableState;
  /** Quem envia (o papel vem da conta: dono da mesa = mestre). */
  viewer: Viewer & { userId: string };
  userName: string;
  now: number;
  /** A mesa passou do tamanho máximo: comandos que acrescentam dados são recusados. */
  full: boolean;
  /** Mundo da mesa: Raças aplicadas na ficha e itens que entram no inventário. */
  world: WorldView;
}

export type RuleResult<P> = { ok: true; payload: P } | { ok: false; reason: string };
type Rule<K extends TableCommandType> = (payload: ValidPayload<K>, ctx: RuleContext) => RuleResult<ValidPayload<K>>;

// --- Limites de quantidade por mesa/cena ---------------------------------------

export const LIMITS = {
  scenes: 100,
  sceneFolders: 100,
  entries: 2000,
  tokensPerScene: 500,
  dropsPerScene: 500,
  wallsPerScene: 5000,
  strokesPerScene: 3000,
  notesPerScene: 500,
  fxPerScene: 100,
  tableItems: 2000,
} as const;

// --- Auxiliares ----------------------------------------------------------------

const allow = <P>(payload: P): RuleResult<P> => ({ ok: true, payload });
const deny = <P>(reason: string): RuleResult<P> => ({ ok: false, reason });
const NOT_ALLOWED = 'Você não tem permissão para isso.';
const ONLY_GM = 'Só o mestre pode fazer isso.';
const FULL = 'A mesa atingiu o tamanho máximo.';

const isGm = (ctx: RuleContext) => ctx.viewer.role === 'gm';
const gmOnly = <K extends TableCommandType>(): Rule<K> => (payload, ctx) => (isGm(ctx) ? allow(payload) : deny(ONLY_GM));
const sceneOf = (state: TableState, sceneId: string): Scene | undefined => state.scenes.find((s) => s.id === sceneId);
const entryOf = (state: TableState, entryId: string | undefined): TableEntry | undefined =>
  entryId ? state.entries.find((e) => e.id === entryId) : undefined;

/** O jogador só mexe na cena aberta (é a única que ele recebe). */
const inActiveScene = (ctx: RuleContext, sceneId: string) => isGm(ctx) || ctx.state.activeSceneId === sceneId;

/**
 * A conta pode editar esta ficha/arquivo? Mestre: tudo. Jogador: o próprio personagem (ou um
 * sem dono), o NPC que o mestre deixou ele controlar e as ações dessas fichas. Mais restrito que
 * o `canEdit` local, onde personagens ficam livres para qualquer jogador (só havia uma pessoa).
 */
export function canEditEntry(state: TableState, entry: TableEntry | undefined, viewer: Viewer, depth = 0): boolean {
  if (!entry) return false;
  if (viewer.role === 'gm') return true;
  switch (entry.kind) {
    case 'character':
      return ownsCharacter(entry, viewer);
    case 'npc':
      return canEdit(entry, viewer);
    case 'automation':
      // Ação de jogador: a ficha dona precisa ser dele (ação sem dono = do mestre)
      return depth < 2 && canEditEntry(state, entryOf(state, entry.ownerEntryId), viewer, depth + 1);
    default:
      return false;
  }
}

/** Token que a conta pode mover/alterar (pela ficha de origem). */
function canEditPlacement(state: TableState, placementId: string, viewer: Viewer): boolean {
  const placement = findPlacement(state.scenes, placementId);
  return !!placement && canEditEntry(state, entryOf(state, placement.entryId), viewer);
}

/** Cena onde está o token. */
function sceneOfPlacement(state: TableState, placementId: string): Scene | undefined {
  return state.scenes.find((s) => s.tokens?.some((t) => t.id === placementId));
}

/**
 * Jogador movendo um token até (x, y): só na cena aberta (a única que ele vê) e sem atravessar
 * parede nem porta fechada da camada do token (`wallsBlockMovement` + `movePathBlocked`, as
 * mesmas regras do front). Devolve o motivo da recusa, ou null.
 */
function playerMoveProblem(ctx: RuleContext, placementId: string, x: number, y: number): string | null {
  const scene = sceneOfPlacement(ctx.state, placementId);
  const placement = scene?.tokens?.find((t) => t.id === placementId);
  if (!scene || !placement || !inActiveScene(ctx, scene.id)) return NOT_ALLOWED;
  if (!wallsBlockMovement(ctx.viewer)) return null;
  const walls = (scene.walls ?? []).filter((w) => levelOf(w) === levelOf(placement));
  return movePathBlocked(placement, { x, y }, wallsToSegments(walls)) ? 'Uma parede bloqueia o caminho.' : null;
}


// --- Regras --------------------------------------------------------------------

export const COMMAND_RULES: { [K in TableCommandType]: Rule<K> } = {
  // Cenas, pastas e camadas: preparação do mestre
  addScene: (p, ctx) => {
    if (!isGm(ctx)) return deny(ONLY_GM);
    if (ctx.full || ctx.state.scenes.length >= LIMITS.scenes) return deny(FULL);
    if (sceneOf(ctx.state, p.scene.id)) return deny('Cena já existe.');
    return allow(p);
  },
  updateScene: gmOnly(),
  setActiveScene: gmOnly(),
  removeScene: gmOnly(),
  addSceneFolder: (p, ctx) => {
    if (!isGm(ctx)) return deny(ONLY_GM);
    const folders = ctx.state.sceneFolders ?? [];
    if (ctx.full || folders.length >= LIMITS.sceneFolders) return deny(FULL);
    return folders.some((f) => f.id === p.folder.id) ? deny('Pasta já existe.') : allow(p);
  },
  renameSceneFolder: gmOnly(),
  removeSceneFolder: gmOnly(),
  moveSceneToFolder: gmOnly(),
  addLevel: (p, ctx) => {
    if (!isGm(ctx)) return deny(ONLY_GM);
    return sceneOf(ctx.state, p.sceneId)?.levels?.some((l) => l.id === p.level.id) ? deny('Camada já existe.') : allow(p);
  },
  renameLevel: gmOnly(),
  setLevelImage: gmOnly(),
  removeLevel: gmOnly(),
  setPlayerLevel: gmOnly(),

  // Fichas, NPCs, sons e ações
  addEntry: (p, ctx) => {
    if (ctx.full || ctx.state.entries.length >= LIMITS.entries) return deny(FULL);
    if (entryOf(ctx.state, p.entry.id)) return deny('Arquivo já existe.');
    if (isGm(ctx)) return allow(p);
    const { entry } = p;
    if (entry.kind === 'character') {
      // Personagem criado por jogador é sempre dele; não escolhe controlador nem vínculo ao bestiário
      const { controllerUserId: _c, worldNpcId: _w, ...rest } = entry;
      // Ficha e barras novas valem como as de um personagem em branco (raça, máximos…)
      const base = defaultToken('character');
      const change = playerSheetChange(ctx, { sheet: normalizeSheet(undefined), bars: base.bars }, { sheet: rest.sheet, bars: rest.token?.bars });
      if (!change.ok) return change;
      const { sheet, bars } = change.payload;
      return allow({
        entry: { ...rest, ownerUserId: ctx.viewer.userId, ...(sheet && { sheet }), ...(bars && { token: { ...(rest.token ?? base), bars } }) },
      });
    }
    if (entry.kind === 'automation' && canEditEntry(ctx.state, entryOf(ctx.state, entry.ownerEntryId), ctx.viewer)) return allow(p);
    return deny(NOT_ALLOWED);
  },
  updateEntry: (p, ctx) => {
    const current = entryOf(ctx.state, p.entryId);
    if (!current) return deny('Arquivo não encontrado.');
    if (isGm(ctx)) return allow(p);
    if (!canEditEntry(ctx.state, current, ctx.viewer)) return deny(NOT_ALLOWED);
    const { patch } = p;
    if (patch.controllerUserId !== undefined || patch.worldNpcId !== undefined || patch.role !== undefined) return deny(ONLY_GM);
    // "Vincular à minha conta": só para a própria conta
    if (patch.ownerUserId !== undefined && patch.ownerUserId !== ctx.viewer.userId) return deny(NOT_ALLOWED);
    if (patch.ownerEntryId !== undefined && !canEditEntry(ctx.state, entryOf(ctx.state, patch.ownerEntryId), ctx.viewer)) return deny(NOT_ALLOWED);
    if (!patch.sheet && !patch.token) return allow(p);
    // Ficha e barras: regras do servidor (raça, SN, máximo das barras de status, itens)
    const token = ctx.world.tokenOf(current);
    const change = playerSheetChange(ctx, { sheet: normalizeSheet(current.sheet), bars: token.bars }, { sheet: patch.sheet, bars: patch.token?.bars });
    if (!change.ok) return change;
    const { sheet, bars } = change.payload;
    return allow({ ...p, patch: { ...patch, ...(sheet && { sheet }), ...(bars && { token: { ...(patch.token ?? token), bars } }) } });
  },
  removeEntry: (p, ctx) => {
    if (isGm(ctx)) return allow(p);
    const entry = entryOf(ctx.state, p.entryId);
    const own = entry?.kind === 'character' ? entry.ownerUserId === ctx.viewer.userId : entry?.kind === 'automation';
    return own && canEditEntry(ctx.state, entry, ctx.viewer) ? allow(p) : deny(NOT_ALLOWED);
  },
  setSoundMaster: gmOnly(),

  // Tokens
  placeToken: (p, ctx) => {
    const scene = sceneOf(ctx.state, p.sceneId);
    if (!scene) return deny('Cena não encontrada.');
    if (ctx.full || (scene.tokens?.length ?? 0) >= LIMITS.tokensPerScene) return deny(FULL);
    if (findPlacement(ctx.state.scenes, p.placement.id)) return deny('Token já existe.');
    const entry = entryOf(ctx.state, p.placement.entryId);
    if (entry?.kind !== 'character' && entry?.kind !== 'npc') return deny('Ficha não encontrada.');
    if (isGm(ctx)) return allow(p);
    if (!inActiveScene(ctx, p.sceneId) || !canEditEntry(ctx.state, entry, ctx.viewer)) return deny(NOT_ALLOWED);
    // Só na camada dos jogadores, e um token por ficha na cena: um segundo token (arrastado ou
    // colado do outro lado de uma parede) seria um jeito de atravessá-la
    if (levelOf(p.placement) !== clampLevelIn(scene, scene.playerLevel ?? 0)) return deny(NOT_ALLOWED);
    if ((scene.tokens ?? []).some((t) => t.entryId === entry.id)) return deny('Esta ficha já tem um token nesta cena.');
    // Token novo do jogador: só a posição; tamanho, barras, ficha e liberações vêm da ficha de
    // origem (`resolveToken` usa a da ficha enquanto o token não tem os próprios valores)
    const { id, entryId, x, y, level } = p.placement;
    return allow({ ...p, placement: { id, entryId, x, y, ...(level !== undefined && { level }) } });
  },
  updatePlacement: (p, ctx) => {
    if (isGm(ctx)) return allow(p);
    if (!canEditPlacement(ctx.state, p.placementId, ctx.viewer)) return deny(NOT_ALLOWED);
    if (p.patch.sheetPublic !== undefined || p.patch.inventoryPublic !== undefined) return deny(ONLY_GM);
    const placement = findPlacement(ctx.state.scenes, p.placementId)!;
    // Trocar de camada é do mestre (PageUp/PageDown); posição, mesmo só x ou só y, passa pelas paredes
    if (p.patch.level !== undefined && p.patch.level !== levelOf(placement)) return deny(ONLY_GM);
    if (p.patch.x !== undefined || p.patch.y !== undefined) {
      const problem = playerMoveProblem(ctx, p.placementId, p.patch.x ?? placement.x, p.patch.y ?? placement.y);
      if (problem) return deny(problem);
    }
    if (!p.patch.sheet && !p.patch.bars) return allow(p);
    // Cópia da ficha no token (NPC que o jogador controla): mesmas regras da ficha
    const entry = entryOf(ctx.state, placement.entryId)!;
    const before = { sheet: normalizeSheet(placement.sheet ?? entry.sheet), bars: placement.bars ?? ctx.world.tokenOf(entry).bars };
    const change = playerSheetChange(ctx, before, { sheet: p.patch.sheet, bars: p.patch.bars });
    if (!change.ok) return change;
    return allow({ ...p, patch: { ...p.patch, ...change.payload } });
  },
  moveToken: (p, ctx) => {
    if (isGm(ctx)) return allow(p);
    if (!canEditPlacement(ctx.state, p.placementId, ctx.viewer)) return deny(NOT_ALLOWED);
    const problem = playerMoveProblem(ctx, p.placementId, p.x, p.y);
    return problem ? deny(problem) : allow(p);
  },
  moveTokens: (p, ctx) => {
    if (isGm(ctx)) return allow(p);
    for (const m of p.moves) {
      if (!canEditPlacement(ctx.state, m.placementId, ctx.viewer)) return deny(NOT_ALLOWED);
      const problem = playerMoveProblem(ctx, m.placementId, m.x, m.y);
      if (problem) return deny(problem);
    }
    return allow(p);
  },
  removeToken: (p, ctx) => (isGm(ctx) || canEditPlacement(ctx.state, p.placementId, ctx.viewer) ? allow(p) : deny(NOT_ALLOWED)),
  toggleTokenPublic: gmOnly(),

  // Itens no mapa: do mestre (largar/pegar pelo jogador vira um comando atômico do servidor — SPEC §1)
  addDrop: (p, ctx) => {
    if (!isGm(ctx)) return deny(ONLY_GM);
    const scene = sceneOf(ctx.state, p.sceneId);
    if (ctx.full || (scene?.drops?.length ?? 0) >= LIMITS.dropsPerScene) return deny(FULL);
    return findDrop(ctx.state.scenes, p.drop.id) ? deny('Item já existe.') : allow(p);
  },
  moveDrop: gmOnly(),
  setDropQuantity: gmOnly(),
  updateDrop: gmOnly(),
  removeDrop: gmOnly(),

  // Névoa e paredes: do mestre; portas, qualquer um na cena aberta
  setFog: gmOnly(),
  setFogMemory: gmOnly(),
  // Memória da névoa gravada pelo jogador revelaria o mapa: até o servidor calcular a visão, só o mestre
  setExplored: gmOnly(),
  addWall: (p, ctx) => {
    if (!isGm(ctx)) return deny(ONLY_GM);
    const walls = sceneOf(ctx.state, p.sceneId)?.walls ?? [];
    if (ctx.full || walls.length >= LIMITS.wallsPerScene) return deny(FULL);
    return walls.some((w) => w.id === p.wall.id) ? deny('Parede já existe.') : allow(p);
  },
  updateWall: gmOnly(),
  toggleDoor: (p, ctx) => {
    const door = sceneOf(ctx.state, p.sceneId)?.walls?.find((w) => w.id === p.doorId);
    if (door?.kind !== 'door') return deny('Porta não encontrada.');
    return inActiveScene(ctx, p.sceneId) ? allow(p) : deny(NOT_ALLOWED);
  },
  removeWall: gmOnly(),

  // Desenhos: qualquer um, na cena aberta
  addStroke: (p, ctx) => {
    if (!inActiveScene(ctx, p.sceneId)) return deny(NOT_ALLOWED);
    const strokes = sceneOf(ctx.state, p.sceneId)?.drawings ?? [];
    if (ctx.full || strokes.length >= LIMITS.strokesPerScene) return deny(FULL);
    return strokes.some((s) => s.id === p.stroke.id) ? deny('Traço já existe.') : allow(p);
  },
  eraseStrokes: (p, ctx) => (inActiveScene(ctx, p.sceneId) ? allow(p) : deny(NOT_ALLOWED)),
  restoreStrokes: (p, ctx) => (inActiveScene(ctx, p.sceneId) && !ctx.full ? allow(p) : deny(NOT_ALLOWED)),

  // Anotações: o jogador cria e edita só as públicas, na cena aberta
  addNote: (p, ctx) => {
    if (!inActiveScene(ctx, p.sceneId)) return deny(NOT_ALLOWED);
    const notes = sceneOf(ctx.state, p.sceneId)?.notes ?? [];
    if (ctx.full || notes.length >= LIMITS.notesPerScene) return deny(FULL);
    if (notes.some((n) => n.id === p.note.id)) return deny('Anotação já existe.');
    return allow(isGm(ctx) ? p : { ...p, note: { ...p.note, gmOnly: false } });
  },
  updateNote: (p, ctx) => {
    if (isGm(ctx)) return allow(p);
    const note = sceneOf(ctx.state, p.sceneId)?.notes?.find((n) => n.id === p.noteId);
    if (!note || note.gmOnly || p.patch.gmOnly || !inActiveScene(ctx, p.sceneId)) return deny(NOT_ALLOWED);
    return allow(p);
  },
  removeNote: (p, ctx) => {
    if (isGm(ctx)) return allow(p);
    const note = sceneOf(ctx.state, p.sceneId)?.notes?.find((n) => n.id === p.noteId);
    return note && !note.gmOnly && inActiveScene(ctx, p.sceneId) ? allow(p) : deny(NOT_ALLOWED);
  },

  // Efeitos fixos: quem lançou fica como dono (carimbado pelo servidor)
  addFixedFx: (p, ctx) => {
    if (!inActiveScene(ctx, p.sceneId)) return deny(NOT_ALLOWED);
    const effects = sceneOf(ctx.state, p.sceneId)?.effects ?? [];
    if (ctx.full || effects.length >= LIMITS.fxPerScene) return deny(FULL);
    if (effects.some((f) => f.id === p.fx.id)) return deny('Efeito já existe.');
    return allow({ ...p, fx: { ...p.fx, ownerUserId: ctx.viewer.userId } });
  },
  removeFixedFx: (p, ctx) => {
    const fx = sceneOf(ctx.state, p.sceneId)?.effects?.find((f) => f.id === p.fxId);
    return fx && canRemoveFixedFx(fx, ctx.viewer) ? allow(p) : deny(NOT_ALLOWED);
  },
  clearFixedFx: (p, ctx) => {
    if (isGm(ctx)) return allow(p);
    const effects = sceneOf(ctx.state, p.sceneId)?.effects ?? [];
    const ids = new Set(p.fxIds ?? []);
    const own = !!p.fxIds && effects.filter((f) => ids.has(f.id)).every((f) => canRemoveFixedFx(f, ctx.viewer));
    return own ? allow(p) : deny(NOT_ALLOWED);
  },

  // Chat: autor, conta, papel e horário vêm do servidor (ninguém fala em nome de outro)
  addChatMessage: (p, ctx) =>
    allow({
      message: {
        ...p.message,
        at: ctx.now,
        userId: ctx.viewer.userId,
        role: ctx.viewer.role,
        author: isGm(ctx) ? 'Mestre' : ctx.userName,
      },
    }),
  clearChat: gmOnly(),

  // Lore e itens da mesa
  toggleLoreReveal: gmOnly(),
  addTableItem: (p, ctx) => {
    const items = ctx.state.items ?? [];
    if (ctx.full || items.length >= LIMITS.tableItems) return deny(FULL);
    if (items.some((i) => i.id === p.item.id)) return deny('Item já existe.');
    return allow({ item: { ...p.item, ownerUserId: ctx.viewer.userId, createdAt: ctx.now } });
  },
  updateTableItem: (p, ctx) => {
    const item = (ctx.state.items ?? []).find((i) => i.id === p.itemId);
    return canEditTableItem(item, ctx.viewer) ? allow(p) : deny(NOT_ALLOWED);
  },
};
