import { defaultToken, npcTokenOf, type TableEntry, type TokenSettings, type WorldItem } from '../domain';

/**
 * Itens do mundo da mesa lidos pela sala: o bestiário (token padrão dos NPCs-referência) e,
 * nas regras dos comandos, as Raças e os itens que o jogador põe no inventário.
 *
 * Leitura síncrona (SQLite) e preguiçosa, com cache: cada item é lido e interpretado uma vez.
 * Quando o Worldbuild muda pela API, a rota avisa o hub (`worldChanged`) e o cache é limpo.
 */
export class WorldView {
  private readonly cache = new Map<string, WorldItem | null>();

  constructor(private readonly load: (itemId: string) => WorldItem | null) {}

  /** Item do mundo, ou undefined se não existe. */
  item(itemId: string): WorldItem | undefined {
    let item = this.cache.get(itemId);
    if (item === undefined) {
      item = this.load(itemId);
      this.cache.set(itemId, item);
    }
    return item ?? undefined;
  }

  /** Pasta (ou item) acima de `itemId` na árvore do mundo. */
  parentOf(itemId: string): string | null | undefined {
    return this.item(itemId)?.parentId;
  }

  /** O Worldbuild mudou: tudo é lido de novo na próxima consulta. */
  invalidate(): void {
    this.cache.clear();
  }

  /**
   * Configuração do token de uma ficha da mesa (mesma regra do `tokenOf` do front-end):
   * NPC-referência usa o token padrão do bestiário; os demais, o da própria entrada.
   */
  tokenOf(entry: TableEntry): TokenSettings {
    const base = entry.worldNpcId ? this.item(entry.worldNpcId) : undefined;
    if (base?.type === 'npc') return npcTokenOf(base);
    return entry.token ?? defaultToken(entry.kind);
  }
}

/** Mundo vazio (testes e mesas sem Worldbuild). */
export const emptyWorld = (): WorldView => new WorldView(() => null);
