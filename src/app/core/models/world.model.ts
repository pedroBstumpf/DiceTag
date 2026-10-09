/**
 * Mundo: um Worldbuild separado do usuário (os itens, pastas, NPCs e raças de um cenário).
 * Cada mesa se passa num mundo (`GameTable.worldId`) e a aba Lore dela mostra os itens dele.
 */
export interface World {
  id: string;
  name: string;
  createdAt: number;
}

/** Limite inicial de mundos por usuário. */
export const MAX_WORLDS = 2;

/** Id do primeiro mundo: usa a chave do Worldbuild de antes dos mundos (nada é migrado). */
export const DEFAULT_WORLD_ID = 'default';

/** Nome do primeiro mundo, criado automaticamente. */
export const DEFAULT_WORLD_NAME = 'Meu mundo';

/** Chave do IndexedDB com os itens do mundo (o primeiro mantém a chave antiga, `worldbuild:<usuário>`). */
export function worldbuildKey(userId: string, worldId: string): string {
  return worldId === DEFAULT_WORLD_ID ? `worldbuild:${userId}` : `worldbuild:${userId}:${worldId}`;
}
