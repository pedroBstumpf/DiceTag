import { Component, inject, input, output } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TokenBar, isDown } from '../../../../../core/models/table-session.model';
import { readableTextOn } from '../../../../../shared/utils/color';
import { BlobUrlService } from '../../../services/blob-url.service';
import { ResolvedToken } from '../../../services/table-session.service';

/** Tipo de dado arrastado do painel lateral para o mapa (id da ficha). */
export const TOKEN_DRAG_TYPE = 'application/x-dicetag-entry';

/** Ponteiro pressionado sobre um token (corpo ou alça de redimensionar). */
export interface TokenPointerDown {
  event: PointerEvent;
  token: ResolvedToken;
  mode: 'move' | 'resize';
}

/** Cor do círculo de tokens sem imagem, por tipo de ficha. */
const NO_IDS: ReadonlySet<string> = new Set();
const INITIAL_BG ={ character: '#3462d6', npc: '#7c4dcc' } as Record<string, string>;
/**
 * Deslize até a posição recebida do servidor. A duração acompanha o intervalo das rajadas de
 * movimento (`BURST_MS` = 100 ms em `TableSessionService`): cada posição nova chega quando o
 * deslize anterior termina, e o movimento dos outros parece contínuo.
 */
const GLIDE = 'transition-[left,top] duration-100 ease-linear motion-reduce:transition-none';

/**
 * Camada de tokens do mapa (dentro do "mundo" transformado).
 * Desenha imagem circular, barras acima e etiquetas abaixo; NPC derrotado
 * (barra de status em 0) ganha um X vermelho. Só exibe e
 * avisa o ponteiro pressionado — o map-stage decide mover/redimensionar.
 * Elementos de interface usam tamanho mínimo legível independente do zoom.
 */
@Component({
  selector: 'app-tokens-layer',
  imports: [MatTooltipModule],
  templateUrl: './tokens-layer.html',
  host: { class: 'pointer-events-none absolute left-0 top-0' },
})
export class TokensLayer {
  readonly blobs = inject(BlobUrlService);

  readonly tokens = input.required<ResolvedToken[]>();
  readonly scale = input.required<number>();
  readonly gridSize = input.required<number>();
  /** Token principal da seleção (só ele tem a alça de redimensionar). */
  readonly selectedId = input<string | null>(null);
  /** Todos os tokens selecionados (anel azul em cada um). */
  readonly selectedIds = input<ReadonlySet<string>>(NO_IDS);
  /** Tokens recebem o ponteiro (ferramenta Selecionar). */
  readonly interactive = input(false);
  /** A conta pode mover/redimensionar o token? (jogador x NPC que não controla: não; sem alça) */
  readonly movable = input<(token: ResolvedToken) => boolean>(() => true);
  /** Vista isométrica: transformação CSS que deixa o token "em pé" (vazio na 2D). */
  readonly upright = input('');
  /** Mesa online: tokens movidos por outras pessoas deslizam entre as posições recebidas. */
  readonly glide = input(false);
  /** Tokens que esta tela está movendo: seguem o ponteiro sem deslize. */
  readonly localMoves = input<ReadonlySet<string>>(NO_IDS);

  readonly tokenDown = output<TokenPointerDown>();

  /** Classes do token: ponteiro conforme a ferramenta e, na mesa online, o deslize. */
  tokenClass(token: ResolvedToken): string {
    const pointer = this.interactive() ? 'pointer-events-auto cursor-grab active:cursor-grabbing' : 'pointer-events-none';
    return this.glide() && !this.localMoves().has(token.placement.id) ? `${pointer} ${GLIDE}` : pointer;
  }

  /** Tamanho em px do mundo que aparece com `screenPx` na tela. */
  ui(screenPx: number): number {
    return screenPx / this.scale();
  }

  /** Tamanho proporcional ao token, mas nunca menor que `minScreenPx` na tela. */
  legible(worldPx: number, minScreenPx: number): number {
    return Math.max(worldPx, minScreenPx / this.scale());
  }

  percent(bar: TokenBar): number {
    return bar.max > 0 ? Math.min(100, Math.max(0, (bar.value / bar.max) * 100)) : 0;
  }

  /** NPC com alguma barra de status zerada: recebe o X vermelho. */
  isDefeated(token: ResolvedToken): boolean {
    return token.entry.kind === 'npc' && isDown(token.bars);
  }

  /** Texto legível sobre a cor da etiqueta (branco em cores escuras, como o preto). */
  readonly textOn = readableTextOn;

  initialBg(token: ResolvedToken): string {
    return INITIAL_BG[token.entry.kind] ?? '#3462d6';
  }

  onDown(event: PointerEvent, token: ResolvedToken, mode: TokenPointerDown['mode']): void {
    // Botão do meio continua movendo o mapa
    if (event.button !== 0) return;
    event.stopPropagation();
    this.tokenDown.emit({ event, token, mode });
  }
}
