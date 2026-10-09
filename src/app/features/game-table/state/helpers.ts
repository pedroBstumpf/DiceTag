import { NPC_TOKEN_SHEET, Scene, TableState, TokenPlacement } from '../../../core/models/table-session.model';

/**
 * Auxiliares puros dos comandos da mesa: localizar e trocar uma cena ou um token
 * sem mudar a referência do resto do estado (os `computed` das outras cenas não recalculam).
 */

/** Payload vazio (comandos sem dados, ex.: limpar o chat). */
export type NoPayload = Record<string, never>;

/** Camada de um token ou parede (dados antigos ficam no térreo). */
export function levelOf(item: { level?: number }): number {
  return item.level ?? 0;
}

/** Id do token se `sheetId` for a ficha de um token de NPC ("npc:<id>"); senão null. */
export function tokenSheetPlacement(sheetId: string): string | null {
  return sheetId.startsWith(NPC_TOKEN_SHEET) ? sheetId.slice(NPC_TOKEN_SHEET.length) : null;
}

/** Aplica `fn` só à cena `sceneId` (cena inexistente = estado igual). */
export function mapScene(state: TableState, sceneId: string, fn: (scene: Scene) => Scene): TableState {
  if (!state.scenes.some((sc) => sc.id === sceneId)) return state;
  return { ...state, scenes: state.scenes.map((sc) => (sc.id === sceneId ? fn(sc) : sc)) };
}

/** Mescla campos na cena `sceneId`. */
export function patchScene(state: TableState, sceneId: string, patch: Partial<Omit<Scene, 'id'>>): TableState {
  return mapScene(state, sceneId, (sc) => ({ ...sc, ...patch }));
}

/** Token colocado (em qualquer das cenas). Recebe só as cenas: quem lê via signal depende só delas. */
export function findPlacement(scenes: readonly Scene[], placementId: string): TokenPlacement | undefined {
  for (const scene of scenes) {
    const found = scene.tokens?.find((t) => t.id === placementId);
    if (found) return found;
  }
  return undefined;
}

/** Aplica `fn` ao token `placementId` (só a cena que o contém muda de referência). */
export function mapPlacement(
  state: TableState,
  placementId: string,
  fn: (placement: TokenPlacement) => TokenPlacement,
): TableState {
  if (!findPlacement(state.scenes, placementId)) return state;
  return {
    ...state,
    scenes: state.scenes.map((sc) =>
      sc.tokens?.some((t) => t.id === placementId)
        ? { ...sc, tokens: sc.tokens.map((t) => (t.id === placementId ? fn(t) : t)) }
        : sc,
    ),
  };
}

/** "Nova pasta", "Nova pasta 2"… sem repetir nomes existentes. */
export function uniqueName(base: string, existing: Iterable<string>): string {
  const names = new Set(existing);
  let name = base;
  for (let n = 2; names.has(name); n++) name = `${base} ${n}`;
  return name;
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
