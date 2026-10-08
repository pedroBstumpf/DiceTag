import { Component, inject, input, output } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TokenBar, isDown } from '../../../../../core/models/table-session.model';
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
const INITIAL_BG = { character: '#3462d6', npc: '#7c4dcc' } as Record<string, string>;

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
  readonly selectedId = input<string | null>(null);
  /** Tokens recebem o ponteiro (ferramenta Selecionar). */
  readonly interactive = input(false);
  /** Vista isométrica: transformação CSS que deixa o token "em pé" (vazio na 2D). */
  readonly upright = input('');

  readonly tokenDown = output<TokenPointerDown>();

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
