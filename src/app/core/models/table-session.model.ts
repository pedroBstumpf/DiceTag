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
  /** automation: de quem é a ação (aparece na barra inferior desse papel). */
  role?: TableRole;
  /** automation: ícone exibido na barra de ações. */
  icon?: string;
}

/** Estado salvo de uma mesa. */
export interface TableState {
  scenes: Scene[];
  activeSceneId: string | null;
  entries: TableEntry[];
}

/** Metadados visuais de cada tipo de arquivo da mesa. */
export const TABLE_ENTRY_META: Record<TableEntryKind, { icon: string; label: string; color: string }> = {
  character: { icon: 'person', label: 'Personagem', color: 'text-astral-300' },
  npc: { icon: 'smart_toy', label: 'NPC', color: 'text-violet-300' },
  sound: { icon: 'music_note', label: 'Som', color: 'text-cyan-300' },
  automation: { icon: 'bolt', label: 'Automação', color: 'text-amber-300' },
};
