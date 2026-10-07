import { Point } from './geometry.model';

/** Papel de quem está usando a mesa. */
export type TableRole = 'gm' | 'player';

/** Ferramentas da barra lateral esquerda da mesa. */
export type TableTool = 'select' | 'pan' | 'ruler' | 'ping' | 'draw' | 'fog' | 'note';

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
  /** Névoa de guerra desta cena. Padrão: desligada. */
  fog?: { enabled: boolean };
  /** Paredes que bloqueiam a visão quando a névoa está ativa. Padrão: []. */
  walls?: Wall[];
  /** Desenhos livres (pincel). Padrão: []. */
  drawings?: Stroke[];
  /** Anotações (marcadores) no mapa. Padrão: []. */
  notes?: MapNote[];
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

/** Parede que bloqueia a visão dos tokens. */
export type Wall = LineWall | CircleWall;

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
  /** automation: de quem é a ação (aparece na barra inferior desse papel). */
  role?: TableRole;
  /** automation: ícone exibido na barra de ações. */
  icon?: string;
  /** character/npc: configuração do token. Padrão: defaultToken(kind). */
  token?: TokenSettings;
}

/** Estado salvo de uma mesa. */
export interface TableState {
  scenes: Scene[];
  activeSceneId: string | null;
  entries: TableEntry[];
  /** Volume mestre dos sons da mesa (0–1). Padrão: 1. */
  soundMaster?: number;
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
export interface TokenTag {
  id: string;
  text: string;
  color: string;
  /** Nível da condição (ex.: exaustão 2). Ausente ou 0 = sem nível. */
  level?: number;
}

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

/** Paleta para barras e etiquetas de tokens (cores livres também são aceitas). */
export const TOKEN_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#2dd4bf',
  '#4f86f7', '#b18cff', '#f472b6', '#e8eefc', '#64748b',
] as const;

/** Token padrão de uma ficha: personagens enxergam, NPCs começam sem visão. */
export function defaultToken(kind: TableEntryKind): TokenSettings {
  return {
    size: 1,
    vision: { enabled: kind === 'character', range: DEFAULT_VISION_RANGE },
    bars: [],
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
