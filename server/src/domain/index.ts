/**
 * Regras de domínio COMPARTILHADAS com o front-end: as mesmas funções puras que o navegador usa
 * (comandos da mesa, permissões, rolagem, paredes), importadas direto de `src/app`.
 *
 * Por que importar em vez de copiar: o servidor aplica exatamente a mesma função que o cliente
 * (SPEC.md §1), então os dois chegam ao mesmo estado, e uma correção vale para os dois lados.
 * Esses arquivos não dependem de Angular (regra do projeto: `state/` e `utils/` são puros).
 *
 * Só este arquivo conhece os caminhos do front-end: se a estrutura mudar, ajuste aqui.
 */

import { rollDice as rollDiceShared, type Random, type TagLevels } from '../../../src/app/features/game-table/utils/dice';
import type { RollConfig } from '../../../src/app/core/models/table-session.model';

export { TABLE_COMMANDS, applyCommand, type TableCommand, type TableCommandType } from '../../../src/app/features/game-table/state/commands';
export { EMPTY_STATE, normalizeState } from '../../../src/app/features/game-table/state/table-state';
export {
  canEdit,
  canEditStatusMax,
  canEditTableItem,
  canRemoveFixedFx,
  canSeeLoreItem,
  controlsNpc,
  ownsCharacter,
  sheetAccess,
  wallsBlockMovement,
  type Viewer,
} from '../../../src/app/features/game-table/state/permissions';
export { findPlacement, levelOf, tokenSheetPlacement } from '../../../src/app/features/game-table/state/helpers';
export { clampLevelIn } from '../../../src/app/features/game-table/state/levels';
export { findDrop } from '../../../src/app/features/game-table/state/drops';
export { inventoryHolder } from '../../../src/app/features/game-table/state/inventory';
export { worldItemRefs } from '../../../src/app/features/game-table/state/lore';
export { equippedTagLevels, quantityOf, type ItemSources } from '../../../src/app/features/game-table/utils/inventory';
export { resolveToken, type ResolvedToken } from '../../../src/app/features/game-table/state/tokens';
export {
  isPointVisible,
  sameVisionSources,
  visibleDoorsFor,
  visibleDropsFor,
  visibleNotesFor,
  visibleTokensFor,
  visionPolygonsOf,
  visionSourcesOf,
  type FogView,
  type VisionSource,
} from '../../../src/app/features/game-table/state/player-view';
export { baseTagId, levelUpText, manaCost, studyGain, trainStudy, withPowers, type TagLevels } from '../../../src/app/features/game-table/utils/dice';
export { movePathBlocked } from '../../../src/app/features/game-table/utils/walls';
export { doorSeen, wallsToSegments, type Segment } from '../../../src/app/features/game-table/utils/visibility';
export { decodeMask, type ExploredMask } from '../../../src/app/features/game-table/utils/fog-memory';
export { applyRace, type RaceChoice } from '../../../src/app/features/game-table/utils/race';
export type { Point } from '../../../src/app/core/models/geometry.model';

export {
  AUTOMATION_ICONS,
  DICE_KINDS,
  FX_KINDS,
  GOAL_STEPS,
  MANA_BAR,
  MAX_CHAT_MESSAGES,
  MAX_TOKEN_SIZE,
  MIN_TOKEN_SIZE,
  NPC_TOKEN_SHEET,
  SHEET_MAX_LEVEL,
  SHEET_STUDY_COUNT,
  SHEET_THEME_COUNT,
  STATUS_BARS,
  defaultToken,
  isDown,
  normalizeSheet,
  withStatusBars,
  type CharacterSheet,
  type CharacterStudy,
  type InventoryEntry,
  type ChatMessage,
  type DoorWall,
  type ExploredData,
  type RollConfig,
  type RollResult,
  type Scene,
  type TableEntry,
  type TableRole,
  type TableState,
  type TokenBar,
  type TokenPlacement,
  type TokenSettings,
  type Wall,
} from '../../../src/app/core/models/table-session.model';
export { MAX_WORLDS } from '../../../src/app/core/models/world.model';
export { TABLE_ACCENTS } from '../../../src/app/core/models/game-table.model';
export { npcSheetOf, npcTokenOf, raceTraitsOf, type WorldItem } from '../../../src/app/core/models/world-item.model';

// --- Adaptações do servidor ------------------------------------------------------

/**
 * `rollDice` do front com o sorteio OBRIGATÓRIO: no front ele usa `Math.random` quando ninguém
 * passa o gerador, e no servidor toda rolagem precisa do gerador criptográfico
 * (BACKEND_SECURITY.md §4.4). Sem gerador, lança em vez de cair no padrão.
 */
export function rollDice(roll: RollConfig, random: Random, levels?: TagLevels): ReturnType<typeof rollDiceShared> {
  if (typeof random !== 'function') throw new Error('rolagem no servidor sem gerador de números aleatórios');
  return rollDiceShared(roll, random, levels);
}
