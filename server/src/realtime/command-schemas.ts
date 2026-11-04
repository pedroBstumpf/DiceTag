import { z } from 'zod';
import {
  FX_KINDS,
  GOAL_STEPS,
  MAX_TOKEN_SIZE,
  MIN_TOKEN_SIZE,
  SHEET_MAX_LEVEL,
  SHEET_STUDY_COUNT,
  SHEET_THEME_COUNT,
  STATUS_BARS,
  type CharacterSheet,
  type TableCommandType,
} from '../domain';
import { idSchema as id } from '../lib/ids';

/**
 * Formato aceito do payload de cada comando da mesa (o mesmo que o front-end monta em
 * `TableSessionService.dispatch`). Todo objeto é `strictObject` (campo desconhecido = comando
 * recusado), todo texto e toda lista têm tamanho máximo e todo número tem faixa — inclusive a
 * ficha, com os limites das regras do jogo (tags de 1 a 6, defeitos de -1 a -6…).
 *
 * `satisfies Record<TableCommandType, …>`: se o front-end ganhar um comando novo sem esquema
 * aqui, o servidor nem compila — nenhum comando passa sem validação. O mesmo vale para um campo
 * novo na ficha (`SHEET_SCHEMA_IS_COMPLETE`).
 */

// --- Peças -------------------------------------------------------------------

/** Coordenada do mapa (px). Limite largo, só para barrar valores absurdos. */
const coord = z.number().min(-1e6).max(1e6);
const point = z.strictObject({ x: coord, y: coord });
/** Cores sempre em hexadecimal (paletas e seletor de cor do front-end). */
const color = z.string().regex(/^#[0-9a-fA-F]{3,8}$/, 'cor inválida');
const level = z.int().min(0).max(10);
const text = (max: number) => z.string().max(max);
const size = z.number().min(MIN_TOKEN_SIZE).max(MAX_TOKEN_SIZE);
const timestamp = z.number().int().min(0).max(8.64e15);
const accountId = z.string().max(64);
const fxKind = z.enum(FX_KINDS.map((f) => f.id) as [string, ...string[]]);

export const tagSchema = z.strictObject({ id, text: text(100), color, level: z.int().min(-99).max(99).optional() });
export const barSchema = z.strictObject({
  id,
  label: text(60),
  value: z.number().min(-1e6).max(1e6),
  max: z.number().min(0).max(1e6),
  color,
});
const vision = z.strictObject({ enabled: z.boolean(), range: z.number().min(0).max(10_000) });
const tokenSettings = z.strictObject({
  blobId: id.optional(),
  size,
  vision,
  speed: z.number().min(0.1).max(100).optional(),
  bars: z.array(barSchema).max(20),
  tags: z.array(tagSchema).max(50),
});

const inventoryEntry = z.strictObject({
  id,
  itemId: id,
  table: z.boolean().optional(),
  name: text(200).optional(),
  tags: z.array(tagSchema).max(50).optional(),
  description: text(20_000).optional(),
  blobId: id.optional(),
  price: z.number().min(0).max(1e9).optional(),
  quantity: z.int().min(0).max(1e6).optional(),
  equipped: z.boolean().optional(),
});

// --- Ficha ---------------------------------------------------------------------

const sheetLevel = z.int().min(1).max(SHEET_MAX_LEVEL);
const goalSteps = z.int().min(0).max(GOAL_STEPS);
const themeTag = z.strictObject({ id, text: text(100), level: sheetLevel, magic: z.boolean().optional() });
const flaw = z.strictObject({ id, text: text(100), level: z.int().min(-SHEET_MAX_LEVEL).max(-1), magic: z.boolean().optional() });
const theme = z.strictObject({
  id,
  name: text(100),
  tags: z.array(themeTag).max(30),
  flaws: z.array(flaw).max(30).optional(),
  goal: text(1000).optional(),
  goalProgress: goalSteps.optional(),
  goalAbandon: goalSteps.optional(),
});
const relation = z.strictObject({ id, name: text(100), level: sheetLevel, description: text(4000) });
const notePage = z.strictObject({ id, title: text(100), content: text(200_000) });
const study = z.strictObject({ id, text: text(200), sa: z.int().min(0).max(1e6), sn: z.int().min(0).max(1e6) });
const statusMods = z.partialRecord(z.enum(STATUS_BARS.map((s) => s.id) as [string, ...string[]]), z.int().min(-1000).max(1000));
const appliedRace = z.strictObject({ labels: z.array(text(100)).max(50), mods: statusMods });
const raceRef = z.strictObject({ id });

/** Ficha (personagem, NPC e cópia de token de NPC). Campos ausentes recebem o padrão em `normalizeSheet`. */
export const sheetSchema = z
  .strictObject({
    race: text(100),
    subrace: text(100),
    raceRef: raceRef.optional(),
    subraceRef: raceRef.optional(),
    appliedRaces: z.strictObject({ race: appliedRace.optional(), subrace: appliedRace.optional() }).optional(),
    labels: z.array(text(100)).max(50),
    relations: z.array(relation).max(100),
    themes: z.array(theme).max(SHEET_THEME_COUNT),
    inventory: z.array(inventoryEntry).max(500),
    notes: z.array(notePage).max(100),
    // Número, não inteiro: o preço de um item (abaixo) pode ter centavos e sai dos Eiros na compra
    eiros: z.number().min(0).max(1e9),
    studies: z.array(study).max(SHEET_STUDY_COUNT),
  })
  .partial();

/** Ficha como chega do cliente (já validada; fichas antigas podem não ter todos os campos). */
export type SheetInput = z.infer<typeof sheetSchema>;

/** Mesmas chaves nos dois tipos? */
type SameKeys<A, B> = [Exclude<keyof A, keyof B> | Exclude<keyof B, keyof A>] extends [never] ? true : false;
/** Só compila se o esquema tiver exatamente os campos de `CharacterSheet` (campo novo no front = servidor não compila). */
export const SHEET_SCHEMA_IS_COMPLETE: SameKeys<z.infer<typeof sheetSchema>, CharacterSheet> = true;

const placementFields = {
  x: coord,
  y: coord,
  level: level.optional(),
  size: size.optional(),
  bars: z.array(barSchema).max(20).optional(),
  tags: z.array(tagSchema).max(50).optional(),
  vision: vision.optional(),
  sheet: sheetSchema.optional(),
  name: text(100).optional(),
  sheetPublic: z.boolean().optional(),
  inventoryPublic: z.boolean().optional(),
};
const placement = z.strictObject({ id, entryId: id, ...placementFields });

/** Lado máximo da memória da névoa, em células (`MAX_CELLS_PER_SIDE` de `utils/fog-memory.ts`). */
const MAX_EXPLORED_CELLS = 600;
const explored = z
  .strictObject({
    cell: z.number().positive().max(10_000),
    cols: z.int().min(1).max(MAX_EXPLORED_CELLS),
    rows: z.int().min(1).max(MAX_EXPLORED_CELLS),
    data: z.string().max(60_000).regex(/^[A-Za-z0-9+/=]*$/),
  })
  // Base64 de um bit por célula: nada além do que a máscara ocupa
  .refine((e) => e.data.length <= 4 * Math.ceil(Math.ceil((e.cols * e.rows) / 8) / 3), 'máscara maior que o tamanho declarado');

const wall = z.discriminatedUnion('kind', [
  z.strictObject({ id, level: level.optional(), kind: z.literal('line'), points: z.array(point).min(2).max(2000) }),
  z.strictObject({ id, level: level.optional(), kind: z.literal('circle'), cx: coord, cy: coord, r: z.number().positive().max(1e6) }),
  z.strictObject({ id, level: level.optional(), kind: z.literal('door'), points: z.array(point).length(2), open: z.boolean() }),
]);

const stroke = z.strictObject({
  id,
  points: z.array(point).min(1).max(5000),
  color,
  width: z.number().positive().max(500),
  opacity: z.number().min(0).max(1),
});

const noteFields = { x: coord, y: coord, title: text(200), text: text(20_000), color, gmOnly: z.boolean() };
const note = z.strictObject({ id, ...noteFields });

const drop = z.strictObject({ id, x: coord, y: coord, level: level.optional(), size: size.optional(), color: color.optional(), item: inventoryEntry });

const fixedFx = z.strictObject({
  id,
  kind: fxKind,
  color,
  from: point,
  to: point,
  seed: z.number().min(0).max(2 ** 53),
  scale: z.number().positive().max(1000),
  level: level.optional(),
  ownerUserId: accountId.optional(),
});

const mapLevel = z.strictObject({ id, name: text(100), blobId: id.optional() });
const folder = z.strictObject({ id, name: text(100) });

export const rollConfig = z.strictObject({
  dice: z.enum(['2d12', '3d6']),
  modifier: z.int().min(-99).max(99),
  attributes: z.array(text(200)).max(100).optional(),
  addItems: z.boolean().optional(),
  powers: z.record(text(200), z.int().min(0).max(99)).optional(),
});
const fxStyle = z.strictObject({ kind: fxKind, color });

const entryFields = {
  name: text(100),
  createdAt: timestamp,
  blobId: id.optional(),
  volume: z.number().min(0).max(1).optional(),
  loop: z.boolean().optional(),
  role: z.enum(['gm', 'player']).optional(),
  icon: text(60).optional(),
  ownerEntryId: id.optional(),
  roll: rollConfig.optional(),
  effect: fxStyle.optional(),
  ownerUserId: accountId.optional(),
  worldNpcId: id.optional(),
  controllerUserId: accountId.optional(),
  token: tokenSettings.optional(),
  sheet: sheetSchema.optional(),
};
export const entrySchema = z.strictObject({ id, kind: z.enum(['character', 'npc', 'sound', 'automation']), ...entryFields });

/** Mensagem do chat vinda do cliente: só texto (rolagens são feitas pelo servidor). */
const chatMessage = z.strictObject({
  id,
  at: timestamp,
  userId: accountId,
  author: text(100),
  role: z.enum(['gm', 'player']),
  text: z.string().min(1).max(4000),
});

const tableItemFields = { name: text(200), tags: z.array(tagSchema).max(50).optional(), description: text(20_000).optional(), blobId: id.optional() };
const tableItem = z.strictObject({ id, ...tableItemFields, ownerUserId: accountId.optional(), createdAt: timestamp });

const scene = z.strictObject({
  id,
  name: text(100),
  blobId: id.optional(),
  gridSize: z.number().min(5).max(1000),
  showGrid: z.boolean(),
  tokens: z.array(placement).max(500).optional(),
  fog: z.strictObject({ enabled: z.boolean(), memory: z.boolean().optional() }).optional(),
  explored: explored.optional(),
  walls: z.array(wall).max(5000).optional(),
  drawings: z.array(stroke).max(3000).optional(),
  notes: z.array(note).max(500).optional(),
  folderId: id.optional(),
  isometric: z.boolean().optional(),
  levels: z.array(mapLevel).max(10).optional(),
  playerLevel: level.optional(),
  drops: z.array(drop).max(500).optional(),
  effects: z.array(fixedFx).max(100).optional(),
});

const move = z.strictObject({ placementId: id, x: coord, y: coord });
/** Id de uma ficha: o da entrada ou o do token de NPC (`npc:<id>`). */
const sheetRef = z.string().max(80).regex(/^(npc:)?[A-Za-z0-9_-]{1,64}$/);
const levelIndex = z.int().min(0).max(10);

// --- Payload de cada comando ---------------------------------------------------

export const COMMAND_SCHEMAS = {
  // Cenas e pastas
  addScene: z.strictObject({ scene }),
  updateScene: z.strictObject({
    sceneId: id,
    patch: z.strictObject({ name: text(100), blobId: id, gridSize: z.number().min(5).max(1000), showGrid: z.boolean(), isometric: z.boolean() }).partial(),
  }),
  setActiveScene: z.strictObject({ sceneId: id }),
  removeScene: z.strictObject({ sceneId: id }),
  addSceneFolder: z.strictObject({ folder }),
  renameSceneFolder: z.strictObject({ folderId: id, name: text(100) }),
  removeSceneFolder: z.strictObject({ folderId: id }),
  moveSceneToFolder: z.strictObject({ sceneId: id, folderId: id.nullable() }),
  // Camadas
  addLevel: z.strictObject({ sceneId: id, level: mapLevel }),
  renameLevel: z.strictObject({ sceneId: id, index: levelIndex, name: text(100) }),
  setLevelImage: z.strictObject({ sceneId: id, index: levelIndex, blobId: id.optional() }),
  removeLevel: z.strictObject({ sceneId: id, index: levelIndex }),
  setPlayerLevel: z.strictObject({ sceneId: id, level: levelIndex }),
  // Arquivos da mesa
  addEntry: z.strictObject({ entry: entrySchema }),
  updateEntry: z.strictObject({ entryId: id, patch: z.strictObject(entryFields).partial() }),
  removeEntry: z.strictObject({ entryId: id }),
  setSoundMaster: z.strictObject({ volume: z.number().min(0).max(1) }),
  // Tokens
  placeToken: z.strictObject({ sceneId: id, placement }),
  updatePlacement: z.strictObject({ placementId: id, patch: z.strictObject(placementFields).partial() }),
  moveToken: move,
  moveTokens: z.strictObject({ moves: z.array(move).min(1).max(200) }),
  removeToken: z.strictObject({ placementId: id }),
  toggleTokenPublic: z.strictObject({ placementId: id, part: z.enum(['sheet', 'inventory']) }),
  // Itens no mapa
  addDrop: z.strictObject({ sceneId: id, drop }),
  moveDrop: z.strictObject({ dropId: id, x: coord, y: coord }),
  setDropQuantity: z.strictObject({ dropId: id, quantity: z.int().min(1).max(1e6) }),
  updateDrop: z.strictObject({ dropId: id, patch: z.strictObject({ size, color }).partial() }),
  removeDrop: z.strictObject({ dropId: id }),
  // Itens que mudam de lugar
  transferItem: z.strictObject({ fromId: sheetRef, inventoryId: id, toId: sheetRef, newEntryId: id, cost: z.number().min(0).max(1e9).optional(), blobId: id.optional() }),
  dropFromInventory: z.strictObject({ sceneId: id, sheetId: sheetRef, inventoryId: id, dropId: id, itemEntryId: id, x: coord, y: coord, level: level.optional(), blobId: id.optional() }),
  pickUpDrop: z.strictObject({ dropId: id, sheetId: sheetRef, newEntryId: id }),
  // Névoa e paredes
  setFog: z.strictObject({ sceneId: id, enabled: z.boolean() }),
  setFogMemory: z.strictObject({ sceneId: id, memory: z.boolean() }),
  setExplored: z.strictObject({ sceneId: id, explored: explored.optional() }),
  addWall: z.strictObject({ sceneId: id, wall }),
  updateWall: z.strictObject({ sceneId: id, wall }),
  toggleDoor: z.strictObject({ sceneId: id, doorId: id }),
  removeWall: z.strictObject({ sceneId: id, wallId: id }),
  // Desenhos e anotações
  addStroke: z.strictObject({ sceneId: id, stroke }),
  eraseStrokes: z.strictObject({ sceneId: id, strokeIds: z.array(id).max(5000) }),
  restoreStrokes: z.strictObject({ sceneId: id, removed: z.array(z.strictObject({ stroke, index: z.int().min(0).max(100_000) })).max(5000) }),
  addNote: z.strictObject({ sceneId: id, note }),
  updateNote: z.strictObject({ sceneId: id, noteId: id, patch: z.strictObject(noteFields).partial() }),
  removeNote: z.strictObject({ sceneId: id, noteId: id }),
  // Efeitos fixos
  addFixedFx: z.strictObject({ sceneId: id, fx: fixedFx }),
  removeFixedFx: z.strictObject({ sceneId: id, fxId: id }),
  clearFixedFx: z.strictObject({ sceneId: id, fxIds: z.array(id).max(1000).optional() }),
  // Chat
  addChatMessage: z.strictObject({ message: chatMessage }),
  clearChat: z.strictObject({}),
  // Lore e itens da mesa
  toggleLoreReveal: z.strictObject({ folderId: id }),
  addTableItem: z.strictObject({ item: tableItem }),
  updateTableItem: z.strictObject({ itemId: id, patch: z.strictObject(tableItemFields).partial() }),
} satisfies Record<TableCommandType, z.ZodType>;

/** Payload do comando `K` já validado. */
export type ValidPayload<K extends TableCommandType> = z.infer<(typeof COMMAND_SCHEMAS)[K]>;

export const COMMAND_TYPES = Object.keys(COMMAND_SCHEMAS) as [TableCommandType, ...TableCommandType[]];
