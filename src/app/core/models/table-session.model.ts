import { Point } from './geometry.model';
import { TAG_COLORS, Tag } from './tag.model';

/** Papel de quem está usando a mesa. */
export type TableRole = 'gm' | 'player';

/** Ferramentas da barra lateral esquerda da mesa. */
export type TableTool = 'select' | 'pan' | 'ruler' | 'ping' | 'draw' | 'fog' | 'note' | 'fx';

/** Cena (mapa) da mesa, exibida no centro da tela. */
export interface Scene {
  id: string;
  name: string;
  /** Imagem do mapa salva no IndexedDB (opcional: cena pode começar vazia). */
  blobId?: string;
  /** Tamanho de um quadrado da grade, em pixels da imagem. */
  gridSize: number;
  showGrid: boolean;
  /** Tokens colocados nesta cena. Padrão: []. */
  tokens?: TokenPlacement[];
  /** Névoa de guerra desta cena. Padrão: desligada; memory (lembrar áreas exploradas) padrão: ligada. */
  fog?: { enabled: boolean; memory?: boolean };
  /** Áreas já vistas pelos tokens (memória da névoa). */
  explored?: ExploredData;
  /** Paredes que bloqueiam a visão quando a névoa está ativa. Padrão: []. */
  walls?: Wall[];
  /** Desenhos livres (pincel). Padrão: []. */
  drawings?: Stroke[];
  /** Anotações (marcadores) no mapa. Padrão: []. */
  notes?: MapNote[];
  /** Pasta da barra de cenas (ausente = fora de pastas). */
  folderId?: string;
  /** Vista isométrica (mapa e tokens como numa mesa vista de lado). Padrão: false. */
  isometric?: boolean;
  /**
   * Camadas do mapa ACIMA do térreo (andares, céu…), de baixo para cima. O térreo é a
   * camada 0 e usa o mapa da cena (`blobId`). Máximo: MAX_MAP_LEVELS no total. Padrão: [].
   */
  levels?: MapLevel[];
  /** Camada que os jogadores veem (0 = térreo). Padrão: 0. */
  playerLevel?: number;
}

/** Camada do mapa acima do térreo. Sem imagem = "ar": mostra a camada de baixo (tokens voando). */
export interface MapLevel {
  id: string;
  name: string;
  blobId?: string;
}

/** Máximo de camadas numa cena (térreo + 4). */
export const MAX_MAP_LEVELS = 5;

/** Pasta da barra de cenas. */
export interface SceneFolder {
  id: string;
  name: string;
}

// --- Anotações ---------------------------------------------------------------

/** Anotação presa a um ponto do mapa (marcador com título e texto). */
export interface MapNote {
  id: string;
  /** Ponto do mapa onde fica a ponta do marcador. */
  x: number;
  y: number;
  title: string;
  text: string;
  color: string;
  /** Só o mestre vê (some na visão de jogador). */
  gmOnly: boolean;
}

/** Cores dos marcadores de anotação. */
export const NOTE_COLORS = ['#facc15', '#7aa7ff', '#ef4444', '#22c55e', '#b18cff', '#e8eefc'] as const;

// --- Desenho -----------------------------------------------------------------

/** Traço do pincel (pontos já simplificados ao finalizar). */
export interface Stroke {
  id: string;
  points: Point[];
  color: string;
  /** Espessura em px do mapa. */
  width: number;
  /** Opacidade (0–1). */
  opacity: number;
}

/** Paleta do pincel: tokens do projeto + branco, vermelho, amarelo e verde. */
export const BRUSH_COLORS = ['#7aa7ff', '#3462d6', '#b6c8f2', '#ffffff', '#ef4444', '#facc15', '#22c55e', '#04060c'] as const;
/** Espessuras do pincel (px do mapa). */
export const BRUSH_WIDTHS = [4, 8, 16, 32] as const;
/** Opacidades do pincel. */
export const BRUSH_OPACITIES = [1, 0.6, 0.3] as const;

/**
 * Memória da névoa: bitset de células exploradas, em base64.
 * `cell` = lado da célula em px do mapa; célula (c, r) = bit c + r × cols.
 */
export interface ExploredData {
  cell: number;
  cols: number;
  rows: number;
  data: string;
}

// --- Paredes -----------------------------------------------------------------

/** Parede em linha (polilinha, ponto a ponto). */
export interface LineWall {
  id: string;
  kind: 'line';
  points: Point[];
}

/** Parede circular (pilar, árvore…), centro e raio em px do mapa. */
export interface CircleWall {
  id: string;
  kind: 'circle';
  cx: number;
  cy: number;
  r: number;
}

/** Porta: segmento entre dois batentes. Fechada bloqueia a visão; aberta deixa passar. */
export interface DoorWall {
  id: string;
  kind: 'door';
  /** Os dois batentes [a, b]. */
  points: Point[];
  open: boolean;
}

/** Parede que bloqueia a visão dos tokens (portas só quando fechadas). */
export type Wall = LineWall | CircleWall | DoorWall;

/** Tipos de arquivo que vivem dentro de uma mesa (painel direito). */
export type TableEntryKind = 'character' | 'npc' | 'sound' | 'automation';

/** Arquivo da mesa: ficha, NPC, som ou automação. Cada um abre numa janela. */
export interface TableEntry {
  id: string;
  kind: TableEntryKind;
  name: string;
  createdAt: number;
  /** sound: arquivo de áudio no IndexedDB. */
  blobId?: string;
  /** sound: volume da faixa (0–1). Padrão: DEFAULT_SOUND_VOLUME. */
  volume?: number;
  /** sound: repetir ao terminar. Padrão: true. */
  loop?: boolean;
  /** automation (legado): papel antigo da ação. Hoje o papel vem do dono (`ownerEntryId`). */
  role?: TableRole;
  /** automation: ícone exibido na barra de ações. */
  icon?: string;
  /**
   * automation: ficha dona da ação. Personagem = ação do jogador dele; NPC = ação do mestre
   * para aquele NPC (vale para cada token dele). Ausente = ação geral do mestre.
   */
  ownerEntryId?: string;
  /** automation: rolagem feita ao usar. Padrão: DEFAULT_ROLL. */
  roll?: RollConfig;
  /** automation: efeito especial que fica "na mão" do usuário ao usar a ação. */
  effect?: FxStyle;
  /** character: conta do jogador dono do personagem (ausente = qualquer um). */
  ownerUserId?: string;
  /** character/npc: configuração do token. Padrão: defaultToken(kind). */
  token?: TokenSettings;
  /** character: ficha do personagem. Padrão: defaultSheet(). */
  sheet?: CharacterSheet;
}

// --- Ficha de personagem -----------------------------------------------------

/** Níveis de relações e de tags de tema: de 1 a 6. */
export const SHEET_MAX_LEVEL = 6;
/** Quantidade fixa de cards de tema na ficha. */
export const SHEET_THEME_COUNT = 3;

/** Relação do personagem com outro personagem (nível de 1 a 6). */
export interface CharacterRelation {
  id: string;
  name: string;
  level: number;
  description: string;
}

/** Tag de um tema: nível de 1 a 6 (tags) ou de -1 a -6 (defeitos). */
export interface ThemeTag {
  id: string;
  text: string;
  level: number;
}

/** Card de tema: nome + tags e defeitos com nível. */
export interface CharacterTheme {
  id: string;
  name: string;
  /** Tags positivas (nível 1 a 6). */
  tags: ThemeTag[];
  /** Defeitos (nível -1 a -6). Fichas antigas ganham [] em `sheetOf`. */
  flaws: ThemeTag[];
}

/** Lista de tags de um tema: positivas ou defeitos. */
export type ThemeTagList = 'tags' | 'flaws';

/**
 * Item no inventário do personagem: referência a um item do mundo (tipo `item` do
 * worldbuild do usuário ou da Lore geral) + personalização própria.
 *
 * Cópia sob demanda: `name`, `tags` e `blobId` só existem depois que o jogador edita
 * o cartão no inventário e, quando presentes, valem no lugar dos do original — sem
 * alterar o item do worldbuild nem o inventário de outros personagens.
 */
export interface InventoryEntry {
  id: string;
  itemId: string;
  /** O item vem da Lore geral (senão, do worldbuild do usuário). */
  global?: boolean;
  /** Nome personalizado (ausente = nome do original). */
  name?: string;
  /** Etiquetas personalizadas (ausente = as do original). */
  tags?: Tag[];
  /** Imagem personalizada no IndexedDB (ausente = a do original). Apagada ao tirar o item. */
  blobId?: string;
}

/** Página das anotações do personagem (texto rico, HTML do Tiptap). */
export interface NotePage {
  id: string;
  title: string;
  content: string;
}

/**
 * Ficha do personagem jogador. As etiquetas e as barras de status (Corpo, Mente,
 * Espírito) ficam no token da ficha (`TableEntry.token`), assim aparecem também no mapa.
 */
export interface CharacterSheet {
  race: string;
  subrace: string;
  /** Rótulos de personagem (texto livre: "Nobre", "Exilado"…). */
  labels: string[];
  relations: CharacterRelation[];
  /** Sempre SHEET_THEME_COUNT temas. */
  themes: CharacterTheme[];
  /** Itens que o personagem possui. */
  inventory: InventoryEntry[];
  /** Anotações do jogador, em páginas (sempre pelo menos uma). */
  notes: NotePage[];
}

/** Ficha vazia de um personagem. */
export function defaultSheet(): CharacterSheet {
  return {
    race: '',
    subrace: '',
    labels: [],
    relations: [],
    themes: Array.from({ length: SHEET_THEME_COUNT }, (_, i) => ({ id: `theme-${i + 1}`, name: '', tags: [], flaws: [] })),
    inventory: [],
    notes: [{ id: 'page-1', title: 'Página 1', content: '' }],
  };
}

/** Barras de status fixas do personagem, na ordem da ficha (também exibidas sobre o token). */
export const STATUS_BARS = [
  { id: 'status-body', label: 'Corpo', color: '#ef4444' },
  { id: 'status-mind', label: 'Mente', color: '#22c55e' },
  { id: 'status-spirit', label: 'Espírito', color: '#4f86f7' },
] as const;

/** Valor máximo inicial das barras de status. */
export const DEFAULT_STATUS_MAX = 10;

/** A barra é uma das barras de status fixas (não pode ser renomeada nem removida)? */
export function isStatusBar(bar: TokenBar): boolean {
  return STATUS_BARS.some((s) => s.id === bar.id);
}

/**
 * Garante as três barras de status no início da lista, com rótulo e cor fixos
 * (mantém valor e máximo já salvos). As demais barras continuam depois delas.
 */
export function withStatusBars(bars: TokenBar[]): TokenBar[] {
  const status = STATUS_BARS.map((s) => {
    const saved = bars.find((b) => b.id === s.id);
    return { ...s, value: saved?.value ?? DEFAULT_STATUS_MAX, max: saved?.max ?? DEFAULT_STATUS_MAX };
  });
  return [...status, ...bars.filter((b) => !isStatusBar(b))];
}

// --- Rolagens ----------------------------------------------------------------

/** Dados que uma ação pode rolar. */
export type DiceKind = '2d12' | '3d6';
export const DICE_KINDS: readonly DiceKind[] = ['2d12', '3d6'];

/** Rolagem de uma ação. */
export interface RollConfig {
  dice: DiceKind;
  /** Modificador fixo somado ao total. */
  modifier: number;
  /**
   * Reservado para a ficha de personagem: ids de atributos cujos valores serão
   * somados ao modificador (ver `effectiveModifier` em utils/dice.ts). Ainda sem uso.
   */
  attributes?: string[];
}

export const DEFAULT_ROLL: RollConfig = { dice: '2d12', modifier: 0 };

/** Resultado possível de uma rolagem (depende do dado: 2d12 = sucesso, 3d6 = sorte). */
export type RollOutcome =
  | 'critical-failure' | 'failure' | 'partial' | 'success' | 'critical-success'
  | 'bad-luck' | 'neutral' | 'good-luck';

/** Rótulo e cores de cada resultado (classes Tailwind completas). */
export const ROLL_OUTCOMES: Record<RollOutcome, { label: string; text: string; ring: string }> = {
  'critical-failure': { label: 'Falha crítica', text: 'text-red-400', ring: 'ring-red-500/50 bg-red-500/10' },
  failure: { label: 'Falha', text: 'text-orange-300', ring: 'ring-orange-400/40 bg-orange-500/10' },
  partial: { label: 'Sucesso parcial', text: 'text-amber-200', ring: 'ring-amber-300/40 bg-amber-400/10' },
  success: { label: 'Sucesso', text: 'text-emerald-300', ring: 'ring-emerald-400/40 bg-emerald-500/10' },
  'critical-success': { label: 'Sucesso crítico!', text: 'text-astral-300', ring: 'ring-astral-300/60 bg-astral-500/15' },
  'bad-luck': { label: 'Azar', text: 'text-violet-300', ring: 'ring-violet-400/40 bg-violet-500/10' },
  neutral: { label: 'Neutro', text: 'text-slate-300', ring: 'ring-white/15 bg-white/5' },
  'good-luck': { label: 'Sorte!', text: 'text-amber-300', ring: 'ring-amber-300/50 bg-amber-400/10' },
};

/** Rolagem feita (fica no chat). */
export interface RollResult {
  /** Nome e ícone da ação usada. */
  action: string;
  icon: string;
  dice: DiceKind;
  /** Valor de cada dado. */
  rolls: number[];
  modifier: number;
  total: number;
  outcome: RollOutcome;
}

/** Ícones disponíveis para automações (barra de ações). Nomes do Material Symbols. */
export const AUTOMATION_ICONS = [
  'bolt', 'swords', 'shield', 'local_fire_department', 'healing', 'auto_awesome', 'casino', 'visibility',
  'directions_run', 'psychology', 'skull', 'favorite', 'water_drop', 'ac_unit', 'air', 'electric_bolt',
  'cyclone', 'volcano', 'tsunami', 'thunderstorm', 'flare', 'science', 'spa', 'eco', 'pets', 'target',
  'sprint', 'sports_martial_arts', 'front_hand', 'self_improvement', 'shield_moon', 'nightlight', 'wb_sunny',
  'star', 'diamond', 'military_tech', 'hearing', 'visibility_off', 'record_voice_over', 'music_note',
  'menu_book', 'key', 'lock_open', 'theater_comedy', 'medication', 'coronavirus', 'hiking', 'explore',
] as const;

// --- Chat --------------------------------------------------------------------

/** Mensagem do chat da mesa: texto digitado ou resultado de rolagem. */
export interface ChatMessage {
  id: string;
  /** Data/hora (ms). */
  at: number;
  /** Conta que enviou. */
  userId: string;
  /** Nome exibido (a conta ou o personagem/NPC que agiu). */
  author: string;
  role: TableRole;
  text?: string;
  roll?: RollResult;
}

/** Máximo de mensagens guardadas por mesa (as mais antigas saem). */
export const MAX_CHAT_MESSAGES = 300;

// --- Efeitos especiais -------------------------------------------------------

/** Formas de efeito especial (desenhadas arrastando no mapa). */
export type FxKind =
  | 'slash' | 'claw' | 'thrust' | 'impact'
  | 'arrow' | 'projectile' | 'fireball' | 'lightning' | 'beam' | 'cone'
  | 'explosion' | 'wave' | 'smoke' | 'meteor' | 'eruption' | 'vortex'
  | 'heal' | 'shield' | 'rune' | 'teleport';

/** Efeito escolhido: forma + cor (a cor representa o elemento). */
export interface FxStyle {
  kind: FxKind;
  color: string;
}

/** Grupos do seletor de efeitos. */
export const FX_GROUPS = ['Golpes', 'Disparos', 'Área', 'Magia'] as const;
export type FxGroup = (typeof FX_GROUPS)[number];

const AIM = 'Arraste da origem até o alvo';
const AREA = 'Arraste do centro até a borda (clique = 1,5 quad.)';

/**
 * Catálogo de efeitos. `radial`: o arraste define centro e raio (não gira com a direção);
 * os demais vão da origem até o alvo. O desenho de cada um fica em utils/effects.ts.
 */
export const FX_KINDS: { id: FxKind; label: string; icon: string; hint: string; group: FxGroup; radial: boolean }[] = [
  { id: 'slash', label: 'Corte', icon: 'content_cut', hint: 'Arraste na direção do golpe', group: 'Golpes', radial: false },
  { id: 'claw', label: 'Garras', icon: 'pets', hint: 'Arraste na direção do golpe', group: 'Golpes', radial: false },
  { id: 'thrust', label: 'Estocada', icon: 'swords', hint: AIM, group: 'Golpes', radial: false },
  { id: 'impact', label: 'Impacto', icon: 'crisis_alert', hint: AREA, group: 'Golpes', radial: true },
  { id: 'arrow', label: 'Flecha', icon: 'arrow_outward', hint: AIM, group: 'Disparos', radial: false },
  { id: 'projectile', label: 'Orbe', icon: 'radio_button_checked', hint: AIM, group: 'Disparos', radial: false },
  { id: 'fireball', label: 'Bola de fogo', icon: 'local_fire_department', hint: AIM, group: 'Disparos', radial: false },
  { id: 'lightning', label: 'Raio', icon: 'bolt', hint: AIM, group: 'Disparos', radial: false },
  { id: 'beam', label: 'Feixe', icon: 'flashlight_on', hint: AIM, group: 'Disparos', radial: false },
  { id: 'cone', label: 'Jato', icon: 'air', hint: 'Arraste da origem até o alcance', group: 'Disparos', radial: false },
  { id: 'explosion', label: 'Explosão', icon: 'flare', hint: AREA, group: 'Área', radial: true },
  { id: 'wave', label: 'Onda', icon: 'radar', hint: AREA, group: 'Área', radial: true },
  { id: 'smoke', label: 'Fumaça', icon: 'cloud', hint: AREA, group: 'Área', radial: true },
  { id: 'meteor', label: 'Meteoros', icon: 'grain', hint: AREA, group: 'Área', radial: true },
  { id: 'eruption', label: 'Erupção', icon: 'landslide', hint: 'Arraste ao longo da linha de estacas', group: 'Área', radial: false },
  { id: 'vortex', label: 'Vórtice', icon: 'cyclone', hint: AREA, group: 'Área', radial: true },
  { id: 'heal', label: 'Cura', icon: 'healing', hint: AREA, group: 'Magia', radial: true },
  { id: 'shield', label: 'Escudo', icon: 'shield', hint: AREA, group: 'Magia', radial: true },
  { id: 'rune', label: 'Runa', icon: 'blur_circular', hint: AREA, group: 'Magia', radial: true },
  { id: 'teleport', label: 'Teleporte', icon: 'move_up', hint: AREA, group: 'Magia', radial: true },
];

/** Cores dos efeitos, por elemento. */
export const FX_COLORS: { color: string; label: string }[] = [
  { color: '#ff7a1a', label: 'Fogo' },
  { color: '#7fe3ff', label: 'Gelo' },
  { color: '#ffe14d', label: 'Eletricidade' },
  { color: '#1fa2ff', label: 'Água' },
  { color: '#7dff5a', label: 'Ácido / veneno' },
  { color: '#3fbf5f', label: 'Natureza' },
  { color: '#c08a4a', label: 'Terra' },
  { color: '#a35cff', label: 'Sombra' },
  { color: '#ff5fd2', label: 'Psíquico' },
  { color: '#fff3b0', label: 'Sagrado' },
  { color: '#ff3355', label: 'Sangue' },
  { color: '#7aa7ff', label: 'Arcano' },
  { color: '#e8eefc', label: 'Físico' },
];

export const DEFAULT_FX: FxStyle = { kind: 'slash', color: '#e8eefc' };

/** Estado salvo de uma mesa. */
export interface TableState {
  scenes: Scene[];
  activeSceneId: string | null;
  entries: TableEntry[];
  /** Volume mestre dos sons da mesa (0–1). Padrão: 1. */
  soundMaster?: number;
  /** Organização da aba Lore nesta mesa. Padrão: sem pastas nem ajustes. */
  lore?: TableLore;
  /** Chat da mesa (mensagens e rolagens). Padrão: []. */
  chat?: ChatMessage[];
  /** Pastas da barra de cenas. Padrão: []. */
  sceneFolders?: SceneFolder[];
}

// --- Lore da mesa ------------------------------------------------------------

/**
 * Organização própria da aba Lore de uma mesa. Os itens continuam vindo do
 * worldbuild e da Lore geral; aqui ficam só ajustes locais (pastas, nomes,
 * itens removidos), que não alteram nem apagam os originais.
 */
export interface TableLore {
  folders: LoreFolder[];
  /** Ajustes por item (chave = id do item do worldbuild ou da Lore geral). */
  items: Record<string, LoreItemOverride>;
}

/** Pasta da aba Lore (existe só nesta mesa). */
export interface LoreFolder {
  id: string;
  name: string;
}

/** Ajustes locais de um item da lore nesta mesa. */
export interface LoreItemOverride {
  /** Nome usado só nesta mesa (ausente = nome original). */
  name?: string;
  /** Pasta da mesa onde o item fica (ausente = raiz). */
  folderId?: string;
  /** Removido desta mesa (o original continua existindo). */
  hidden?: boolean;
}

// --- Tokens ------------------------------------------------------------------

/** Barra exibida acima do token (ex.: PV 12/20). */
export interface TokenBar {
  id: string;
  label: string;
  value: number;
  max: number;
  color: string;
}

/** Etiqueta exibida abaixo do token (ex.: "Envenenado", "Exaustão 2"). */
export type TokenTag = Tag;

/** Visão do token (usada pela névoa de guerra). */
export interface TokenVision {
  enabled: boolean;
  /** Alcance em metros (convertido para quadrados com METERS_PER_SQUARE). */
  range: number;
}

/** Configuração do token de um personagem/NPC (fica na ficha). */
export interface TokenSettings {
  /** Imagem do token no IndexedDB. Sem imagem: inicial do nome num círculo. */
  blobId?: string;
  /** Tamanho em quadrados da grade (0.5, 1, 2, 3, 4; a alça usa passos de 0.5). */
  size: number;
  vision: TokenVision;
  /** Velocidade do movimento por WASD/setas, em quadrados por segundo. Padrão: DEFAULT_TOKEN_SPEED. */
  speed?: number;
  bars: TokenBar[];
  tags: TokenTag[];
}

/**
 * Token colocado numa cena. `x`/`y` é o centro, em coordenadas do mapa.
 * Personagem: size/bars/tags vêm da ficha (vinculado).
 * NPC: size/bars/tags são copiados ao colocar (cada token é independente).
 */
export interface TokenPlacement {
  id: string;
  entryId: string;
  x: number;
  y: number;
  /** Camada do mapa onde o token está (0 = térreo). Padrão: 0. */
  level?: number;
  size?: number;
  bars?: TokenBar[];
  tags?: TokenTag[];
}

/** Tamanhos oferecidos na configuração do token (em quadrados). */
export const TOKEN_SIZES = [0.5, 1, 2, 3, 4] as const;
export const MIN_TOKEN_SIZE = 0.5;
export const MAX_TOKEN_SIZE = 4;

/** Metros por quadrado da grade (padrão da maioria dos sistemas). */
export const METERS_PER_SQUARE = 1.5;

/** Alcance de visão padrão, em metros. */
export const DEFAULT_VISION_RANGE = 18;

/** Velocidade do token com WASD/setas (quadrados por segundo): padrão e limites. */
export const DEFAULT_TOKEN_SPEED = 2;
export const MIN_TOKEN_SPEED = 0.5;
export const MAX_TOKEN_SPEED = 12;

/** Paleta para barras e etiquetas de tokens (a mesma das etiquetas em geral). */
export const TOKEN_COLORS = TAG_COLORS;

/**
 * Token padrão de uma ficha: personagens enxergam e têm as barras de status
 * (Corpo, Mente, Espírito); NPCs começam sem visão e sem barras.
 */
export function defaultToken(kind: TableEntryKind): TokenSettings {
  return {
    size: 1,
    vision: { enabled: kind === 'character', range: DEFAULT_VISION_RANGE },
    bars: kind === 'character' ? withStatusBars([]) : [],
    tags: [],
  };
}

// --- Sons --------------------------------------------------------------------

/** Volume inicial de uma faixa de som. */
export const DEFAULT_SOUND_VOLUME = 0.8;

/** Metadados visuais de cada tipo de arquivo da mesa. */
export const TABLE_ENTRY_META: Record<TableEntryKind, { icon: string; label: string; color: string }> = {
  character: { icon: 'person', label: 'Personagem', color: 'text-astral-300' },
  npc: { icon: 'smart_toy', label: 'NPC', color: 'text-violet-300' },
  sound: { icon: 'music_note', label: 'Som', color: 'text-cyan-300' },
  automation: { icon: 'bolt', label: 'Automação', color: 'text-amber-300' },
};
