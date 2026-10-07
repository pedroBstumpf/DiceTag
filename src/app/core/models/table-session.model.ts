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
}

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

/** Etiqueta exibida abaixo do token (ex.: "Envenenado"). */
export interface TokenTag {
  id: string;
  text: string;
  color: string;
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

/** Cores para barras e etiquetas de tokens. */
export const TOKEN_COLORS = ['#ef4444', '#22c55e', '#4f86f7', '#eab308', '#b18cff', '#f97316', '#e8eefc'] as const;

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
