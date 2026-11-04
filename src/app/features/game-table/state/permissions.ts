import { FixedFx, TableEntry, TableItem, TableRole, TokenBar, TokenPlacement, isDown } from '../../../core/models/table-session.model';

/**
 * Regras de permissão da mesa em funções puras: quem vê e quem edita o quê.
 *
 * Hoje servem para esconder botões e bloquear edição na tela. No multiplayer, o servidor
 * aplica as MESMAS funções antes de aceitar um comando (o navegador não é confiável),
 * por isso não dependem de Angular nem de signals: recebem quem está olhando (`Viewer`).
 */

/** Quem está agindo: o papel na mesa e a conta. */
export interface Viewer {
  role: TableRole;
  userId: string | undefined;
  /**
   * Mesa online: várias contas de verdade, então o personagem de outro jogador é só leitura
   * (a mesma regra do servidor). Na mesa local há uma pessoa só e os personagens ficam livres.
   */
  shared?: boolean;
}

/** O que a conta pode fazer com uma ficha. */
export interface SheetAccess {
  edit: boolean;
  /** Ver a aba Ficha. */
  sheet: boolean;
  /** Ver o inventário (e comprar/lootear, se for token de NPC). */
  inventory: boolean;
}

export const FULL_ACCESS: SheetAccess = { edit: true, sheet: true, inventory: true };
export const NO_ACCESS: SheetAccess = { edit: false, sheet: false, inventory: false };

/** O NPC foi liberado pelo mestre para esta conta. */
export function controlsNpc(entry: TableEntry, viewer: Viewer): boolean {
  return !!entry.controllerUserId && entry.controllerUserId === viewer.userId;
}

/** O personagem é desta conta? (personagem sem dono vale para qualquer um) */
export function ownsCharacter(entry: TableEntry, viewer: Viewer): boolean {
  return !entry.ownerUserId || entry.ownerUserId === viewer.userId;
}

/** Pode editar a ficha: o mestre sempre; NPC só o jogador autorizado; personagens seguem livres. */
export function canEdit(entry: TableEntry, viewer: Viewer): boolean {
  if (viewer.role === 'gm') return true;
  if (entry.kind === 'npc') return controlsNpc(entry, viewer);
  return !viewer.shared || entry.kind !== 'character' || ownsCharacter(entry, viewer);
}

/**
 * O que a conta pode fazer com uma ficha:
 * - quem edita (mestre; NPC: o jogador autorizado) vê e edita tudo;
 * - token de NPC (`placement`): os jogadores veem a ficha e/ou o inventário que o mestre deixou
 *   públicos naquele token — e o inventário de um token derrotado sempre;
 * - personagem de outro jogador (mesa online): ficha e inventário em só leitura;
 * - NPC do painel (ficha base, sem `placement`): só quem edita.
 * `sheet`: a entrada dona da ficha (ausente fora da mesa) e as barras de status exibidas.
 */
export function sheetAccess(
  viewer: Viewer,
  sheet: { entry?: TableEntry; bars: TokenBar[] } | null,
  placement?: TokenPlacement,
): SheetAccess {
  if (!sheet) return NO_ACCESS;
  if (!sheet.entry || canEdit(sheet.entry, viewer)) return FULL_ACCESS;
  if (sheet.entry.kind === 'character') return { edit: false, sheet: true, inventory: true };
  if (!placement) return NO_ACCESS;
  return { edit: false, sheet: !!placement.sheetPublic, inventory: !!placement.inventoryPublic || isDown(sheet.bars) };
}

/**
 * O jogador pode ver este item da lore? Só se ele (pasta) ou alguma pasta acima dele no mundo
 * foi revelada nesta mesa (`revealed`). Itens criados na mesa ficam à vista de todos.
 * O mestre vê tudo. `parentOf` dá a pasta de um item do mundo (null/undefined = raiz).
 */
export function canSeeLoreItem(
  revealed: ReadonlySet<string>,
  parentOf: (id: string) => string | null | undefined,
  itemId: string,
  isTableItem: boolean,
  viewer: Viewer,
): boolean {
  if (viewer.role === 'gm' || isTableItem) return true;
  const seen = new Set<string>();
  for (let id: string | null | undefined = itemId; id && !seen.has(id); id = parentOf(id)) {
    if (revealed.has(id)) return true;
    seen.add(id);
  }
  return false;
}

/**
 * Editar à mão o valor MÁXIMO das barras de status (Corpo, Mente, Espírito): só o mestre.
 * O jogador muda o valor atual; o máximo dele só muda por regra (ex.: escolher a raça).
 */
export function canEditStatusMax(viewer: Viewer): boolean {
  return viewer.role === 'gm';
}

/**
 * Paredes e portas fechadas impedem o movimento dos tokens do jogador (arrastar, WASD, alinhar à
 * grade). O mestre move livre (para posicionar a cena). Teste do caminho: `movePathBlocked`.
 */
export function wallsBlockMovement(viewer: Viewer): boolean {
  return viewer.role === 'player';
}

/**
 * Itens no mapa: largar itens do mundo/da mesa (aba Lore), mover, mudar a quantidade e tirar
 * do mapa é do mestre. Largar do próprio inventário e pegar um item dependem de editar a ficha
 * (`sheetAccess(...).edit`) e, para pegar, de ver o item (`visibleDropsFor`).
 */
export function canManageDrops(viewer: Viewer): boolean {
  return viewer.role === 'gm';
}

/** Tirar um efeito fixo do mapa: quem o lançou e o mestre. */
export function canRemoveFixedFx(fx: FixedFx, viewer: Viewer): boolean {
  return viewer.role === 'gm' || (!!fx.ownerUserId && fx.ownerUserId === viewer.userId);
}

/** Quem criou o item da mesa (e o mestre) edita o original; os demais só a cópia do inventário. */
export function canEditTableItem(item: TableItem | undefined, viewer: Viewer): boolean {
  return !!item && (viewer.role === 'gm' || item.ownerUserId === viewer.userId);
}
