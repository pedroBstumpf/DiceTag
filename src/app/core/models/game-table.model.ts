/** Mesa de jogo criada por um usuário (mestre). */
export interface GameTable {
  id: string;
  ownerId: string;
  name: string;
  system: string;
  description: string;
  maxPlayers: number;
  /** Cor de destaque usada no cartão da mesa. */
  accent: string;
  /** Mundo onde a mesa se passa (a aba Lore mostra os itens dele). Ausente = o primeiro mundo. */
  worldId?: string;
  createdAt: number;
}

/** Dados necessários para criar uma mesa. */
export type NewGameTable = Pick<GameTable, 'name' | 'system' | 'description' | 'maxPlayers' | 'accent' | 'worldId'>;

/** Sistemas sugeridos no formulário de criação. */
export const GAME_SYSTEMS = [
  'D&D 5e',
  'Tormenta20',
  'Ordem Paranormal',
  'Pathfinder 2e',
  'Call of Cthulhu',
  'Vampiro: A Máscara',
  'Sistema próprio',
] as const;

/** Cores de destaque disponíveis para as mesas. */
export const TABLE_ACCENTS = ['#4f86f7', '#b18cff', '#5fd4e0', '#e8eefc', '#ff8fb1', '#ffc66d'] as const;
