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
export { baseTagId, manaCost, rollDice, withPowers, type TagLevels } from '../../../src/app/features/game-table/utils/dice';
export { movePathBlocked } from '../../../src/app/features/game-table/utils/walls';
export { doorSeen, wallsToSegments, type Segment } from '../../../src/app/features/game-table/utils/visibility';
export { decodeMask, type ExploredMask } from '../../../src/app/features/game-table/utils/fog-memory';
export type { Point } from '../../../src/app/core/models/geometry.model';

export {
  AUTOMATION_ICONS,
  DICE_KINDS,
  FX_KINDS,
  MANA_BAR,
  MAX_CHAT_MESSAGES,
  MAX_TOKEN_SIZE,
  MIN_TOKEN_SIZE,
  NPC_TOKEN_SHEET,
  STATUS_BARS,
  defaultToken,
  isDown,
  normalizeSheet,
  type CharacterSheet,
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
export { npcTokenOf, type WorldItem } from '../../../src/app/core/models/world-item.model';
