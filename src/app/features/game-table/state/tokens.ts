import {
  DEFAULT_TOKEN_SPEED,
  TableEntry,
  TableEntryKind,
  TableState,
  TokenBar,
  TokenPlacement,
  TokenSettings,
  TokenTag,
  TokenVision,
} from '../../../core/models/table-session.model';
import { mapPlacement, mapScene } from './helpers';

/**
 * Tokens no mapa: comandos (colocar, mover, alterar, remover) e a regra de vínculo
 * entre o token colocado e a ficha, em funções puras.
 */

/**
 * Token com as configurações efetivas (regra de vínculo já aplicada).
 * É o que o mapa e a janela "Token" exibem.
 */
export interface ResolvedToken {
  placement: TokenPlacement;
  entry: TableEntry;
  /** Nome exibido (NPC: o nome próprio do token, se houver). */
  name: string;
  /** Personagem: alterações valem para a ficha e todos os tokens dela. */
  linked: boolean;
  blobId?: string;
  size: number;
  vision: TokenVision;
  /** Quadrados por segundo com WASD/setas (sempre da ficha). */
  speed: number;
  bars: TokenBar[];
  tags: TokenTag[];
}

/** Campos do token editáveis pela ficha ou pela janela "Token". */
export type TokenPatch = Partial<Pick<TokenSettings, 'size' | 'vision' | 'speed' | 'bars' | 'tags'>>;

/** Campos de um token colocado que podem ser alterados (id e ficha de origem são fixos). */
export type PlacementPatch = Partial<Omit<TokenPlacement, 'id' | 'entryId'>>;

// --- Regra de vínculo --------------------------------------------------------

/**
 * Configurações efetivas de um token colocado — único lugar da regra de vínculo:
 * - Personagem: tamanho, visão, barras e etiquetas vêm sempre da ficha (`settings`).
 * - NPC: usa os valores próprios da colocação (copiados ao colocar); sem eles, os da ficha.
 * Imagem e velocidade vêm sempre da ficha.
 */
export function resolveToken(placement: TokenPlacement, entry: TableEntry, settings: TokenSettings): ResolvedToken {
  const linked = entry.kind === 'character';
  return {
    placement,
    entry,
    name: placement.name ?? entry.name,
    linked,
    blobId: settings.blobId,
    vision: linked ? settings.vision : (placement.vision ?? settings.vision),
    speed: settings.speed ?? DEFAULT_TOKEN_SPEED,
    size: linked ? settings.size : (placement.size ?? settings.size),
    bars: linked ? settings.bars : (placement.bars ?? settings.bars),
    tags: linked ? settings.tags : (placement.tags ?? settings.tags),
  };
}

/**
 * Para onde vai cada campo alterado num token: personagem grava tudo na ficha (vale para
 * todos os tokens dele); NPC grava a velocidade na ficha e o resto (inclusive a visão) só neste token.
 */
export function splitTokenPatch(
  kind: TableEntryKind,
  patch: TokenPatch,
): { settings: Partial<TokenSettings> | null; placement: PlacementPatch | null } {
  if (kind === 'character') return { settings: patch, placement: null };
  const { speed, ...own } = patch;
  return {
    settings: speed !== undefined ? { speed } : null,
    placement: Object.keys(own).length ? own : null,
  };
}

/**
 * Cópia exata de um token colocado (Ctrl+C / Ctrl+V): tudo dele (tamanho, visão, barras,
 * etiquetas, nome próprio, ficha do NPC, liberações aos jogadores), com outro id, posição e
 * camada. Objeto novo em profundidade: alterar a cópia não mexe no original.
 * As imagens do inventário continuam com os mesmos `blobId`: quem cola as duplica.
 */
export function copyPlacement(source: TokenPlacement, at: { id: string; x: number; y: number; level: number }): TokenPlacement {
  const { level: _level, ...copy } = structuredClone(source);
  return { ...copy, id: at.id, x: at.x, y: at.y, ...(at.level > 0 && { level: at.level }) };
}

// --- Comandos ----------------------------------------------------------------

/** Coloca um token (já montado: id, posição, camada e, no NPC, as cópias) na cena. */
export function placeToken(state: TableState, p: { sceneId: string; placement: TokenPlacement }): TableState {
  return mapScene(state, p.sceneId, (sc) => ({ ...sc, tokens: [...(sc.tokens ?? []), p.placement] }));
}

export function updatePlacement(state: TableState, p: { placementId: string; patch: PlacementPatch }): TableState {
  return mapPlacement(state, p.placementId, (t) => ({ ...t, ...p.patch }));
}

export function moveToken(state: TableState, p: { placementId: string; x: number; y: number }): TableState {
  return mapPlacement(state, p.placementId, (t) => ({ ...t, x: p.x, y: p.y }));
}

/** Remove o token do mapa (a ficha continua). */
export function removeToken(state: TableState, { placementId }: { placementId: string }): TableState {
  return {
    ...state,
    scenes: state.scenes.map((sc) =>
      sc.tokens?.some((t) => t.id === placementId) ? { ...sc, tokens: sc.tokens.filter((t) => t.id !== placementId) } : sc,
    ),
  };
}

/** Mestre: alterna a ficha ou o inventário de um token de NPC como visível aos jogadores. */
export function toggleTokenPublic(state: TableState, p: { placementId: string; part: 'sheet' | 'inventory' }): TableState {
  return mapPlacement(state, p.placementId, (t) =>
    p.part === 'sheet'
      ? { ...t, sheetPublic: !t.sheetPublic || undefined }
      : { ...t, inventoryPublic: !t.inventoryPublic || undefined },
  );
}
