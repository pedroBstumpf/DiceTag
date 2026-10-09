import { Tag } from './tag.model';
import { CharacterSheet, TokenSettings, defaultToken, normalizeSheet, withStatusBars } from './table-session.model';

/**
 * Tipos de item que podem existir no worldbuild.
 * `item` = objeto do mundo (espada, poção…) com cartão: imagem, nome e etiquetas.
 * `npc` = ficha base de um NPC/criatura (bestiário); as mesas usam referências a ela.
 */
export type WorldItemType = 'folder' | 'document' | 'timeline' | 'image' | 'item' | 'npc';

/** Evento de uma linha do tempo. A data é texto livre (calendários de fantasia). */
export interface TimelineEvent {
  id: string;
  title: string;
  date: string;
  description: string;
  color: string;
  /** Posição do cartão no quadro (canto superior esquerdo). Linhas antigas são migradas ao carregar. */
  x?: number;
  y?: number;
}

/** Conexão (seta) entre dois eventos da linha do tempo. */
export interface TimelineLink {
  id: string;
  /** Id do evento de origem. */
  from: string;
  /** Id do evento de destino. */
  to: string;
  /** Rótulo opcional exibido no meio da seta. */
  label?: string;
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
  /** timeline: eventos (cartões posicionados livremente no quadro). */
  events?: TimelineEvent[];
  /** timeline: conexões entre eventos. */
  links?: TimelineLink[];
  /** image / item: id da imagem salva no IndexedDB (no item, é opcional). */
  blobId?: string;
  /** item: etiquetas do cartão. Padrão: []. */
  tags?: Tag[];
  /** item: descrição do cartão (texto livre). Padrão: ''. */
  description?: string;
  /** npc: ficha base (temas, inventário…). Padrão: normalizeSheet(undefined). */
  sheet?: CharacterSheet;
  /** npc: token padrão (imagem, tamanho, visão, barras e etiquetas). Padrão: defaultToken('npc'). */
  token?: TokenSettings;
}

/** Ficha base de um NPC do bestiário, com os padrões aplicados. */
export function npcSheetOf(item: WorldItem): CharacterSheet {
  return normalizeSheet(item.sheet);
}

/** Token padrão de um NPC do bestiário (sempre com as barras de status). */
export function npcTokenOf(item: WorldItem): TokenSettings {
  const token = { ...defaultToken('npc'), ...item.token };
  return { ...token, bars: withStatusBars(token.bars) };
}

/** Metadados visuais de cada tipo (ícone e rótulo). */
export const WORLD_ITEM_META: Record<WorldItemType, { icon: string; label: string; color: string }> = {
  folder: { icon: 'folder', label: 'Pasta', color: 'text-star-400' },
  document: { icon: 'description', label: 'Documento', color: 'text-sky-300' },
  timeline: { icon: 'timeline', label: 'Linha do tempo', color: 'text-astral-300' },
  image: { icon: 'map', label: 'Mapa / Imagem', color: 'text-violet-300' },
  item: { icon: 'inventory_2', label: 'Item', color: 'text-amber-300' },
  npc: { icon: 'smart_toy', label: 'NPC', color: 'text-violet-300' },
};

/** Cores disponíveis para eventos da linha do tempo. */
export const TIMELINE_COLORS = ['#7aa7ff', '#e8eefc', '#b18cff', '#5fd4e0', '#ff8fb1', '#ffc66d'] as const;
