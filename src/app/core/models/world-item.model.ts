/** Tipos de item que podem existir no worldbuild. */
export type WorldItemType = 'folder' | 'document' | 'timeline' | 'image';

/** Evento de uma linha do tempo. A data é texto livre (calendários de fantasia). */
export interface TimelineEvent {
  id: string;
  title: string;
  date: string;
  description: string;
  color: string;
}

/**
 * Item do worldbuild. Todos os tipos compartilham a mesma estrutura
 * de árvore (parentId), e cada tipo usa apenas os campos que precisa.
 */
export interface WorldItem {
  id: string;
  type: WorldItemType;
  name: string;
  /** null = item na raiz. */
  parentId: string | null;
  createdAt: number;
  updatedAt: number;

  /** document: conteúdo em HTML gerado pelo editor. */
  content?: string;
  /** timeline: eventos em ordem cronológica (ordem manual). */
  events?: TimelineEvent[];
  /** image: id do arquivo salvo no IndexedDB. */
  blobId?: string;
}

/** Metadados visuais de cada tipo (ícone e rótulo). */
export const WORLD_ITEM_META: Record<WorldItemType, { icon: string; label: string; color: string }> = {
  folder: { icon: 'folder', label: 'Pasta', color: 'text-star-400' },
  document: { icon: 'description', label: 'Documento', color: 'text-sky-300' },
  timeline: { icon: 'timeline', label: 'Linha do tempo', color: 'text-astral-300' },
  image: { icon: 'map', label: 'Mapa / Imagem', color: 'text-violet-300' },
};

/** Cores disponíveis para eventos da linha do tempo. */
export const TIMELINE_COLORS = ['#7aa7ff', '#e8eefc', '#b18cff', '#5fd4e0', '#ff8fb1', '#ffc66d'] as const;
