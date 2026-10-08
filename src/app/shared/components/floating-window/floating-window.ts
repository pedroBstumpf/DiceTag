import { Component, DestroyRef, ElementRef, computed, inject, input, model, output } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { WindowGeometry } from './window-geometry';

/** Ação de ponteiro em andamento (arrastar ou redimensionar por uma borda). */
type PointerAction = 'move' | 'resize-e' | 'resize-s' | 'resize-se';

const MIN_WIDTH = 280;
const MIN_HEIGHT = 180;
const HEADER_HEIGHT = 44;

/**
 * Janela flutuante reutilizável.
 *
 * - Arrastar pela barra de título; redimensionar pelas bordas
 * - Minimizar (fica só a barra de título, estreita: título + botões)
 * - Maximizar (duplo clique na barra ou botão)
 * - Fixar (trava posição e tamanho onde o usuário deixou)
 *
 * Deve ficar dentro de um contêiner com `position: relative`, que
 * funciona como área de trabalho (limita onde a janela pode ir).
 * Em telas pequenas, quando aberta, ocupa toda a área automaticamente.
 *
 * Uso:
 *   <app-floating-window title="Mapa" [(geometry)]="geo" [(minimized)]="min" [(pinned)]="pin"
 *                        (closed)="..." (focused)="...">
 *     conteúdo
 *   </app-floating-window>
 */
@Component({
  selector: 'app-floating-window',
  imports: [MatIcon, MatIconButton, MatTooltip],
  templateUrl: './floating-window.html',
  host: {
    class:
      'pointer-events-auto absolute flex flex-col overflow-hidden rounded-xl border bg-ink-850/95 shadow-2xl shadow-black/60 backdrop-blur-md animate-fade-in',
    '[class]': 'stateClass()',
    '[style.z-index]': 'zIndex()',
    '[style.left.px]': 'maximized() ? null : geometry().x',
    '[style.top.px]': 'maximized() ? null : geometry().y',
    // Minimizada: só a largura do título + botões (até 22rem, ver stateClass), para não cobrir o mapa
    '[style.width.px]': 'maximized() || minimized() ? null : geometry().width',
    '[style.height.px]': 'maximized() ? null : minimized() ? headerHeight : geometry().height',
    '(pointerdown)': 'focused.emit()',
  },
})
export class FloatingWindow {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly headerHeight = HEADER_HEIGHT;

  // --- Entradas / saídas ---------------------------------------------------
  readonly title = input.required<string>();
  readonly icon = input('web_asset');
  readonly iconClass = input('');
  readonly zIndex = input(1);
  readonly active = input(false);

  /** Posição/tamanho (two-way: [(geometry)]). */
  readonly geometry = model.required<WindowGeometry>();
  /** Ocupa toda a área de trabalho. */
  readonly maximized = model(false);
  /** Recolhida: apenas a barra de título fica visível. */
  readonly minimized = model(false);
  /** Fixada: não pode ser movida nem redimensionada. */
  readonly pinned = model(false);

  readonly closed = output<void>();
  readonly focused = output<void>();

  /** Classes que dependem do estado (borda ativa, maximizada, mobile). */
  protected readonly stateClass = computed(() =>
    [
      this.active() ? 'border-astral-400/50' : 'border-white/10',
      this.maximized() ? 'inset-0 rounded-none' : '',
      // No mobile a janela aberta ocupa a tela; minimizada continua compacta (largura do conteúdo, até 22rem)
      this.minimized() ? 'w-max max-w-[22rem]' : 'max-md:inset-0! max-md:w-auto! max-md:h-auto! max-md:rounded-none',
    ].join(' '),
  );

  // --- Estado do arraste ---------------------------------------------------
  private action: PointerAction | null = null;
  private start = { px: 0, py: 0, geo: {} as WindowGeometry };

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopPointer());
  }

  // --- Interação -----------------------------------------------------------

  /** Inicia arraste/redimensionamento. Ignora cliques em botões da barra. */
  startPointer(event: PointerEvent, action: PointerAction): void {
    if (event.button !== 0 || this.maximized() || this.pinned()) return;
    if (action === 'move' && (event.target as HTMLElement).closest('button')) return;

    event.preventDefault();
    this.action = action;
    this.start = { px: event.clientX, py: event.clientY, geo: { ...this.geometry() } };

    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.stopPointer);
  }

  toggleMaximize(): void {
    this.minimized.set(false);
    this.maximized.update((v) => !v);
  }

  toggleMinimize(): void {
    this.maximized.set(false);
    this.minimized.update((v) => !v);
  }

  togglePin(): void {
    this.pinned.update((v) => !v);
  }

  // --- Internos ------------------------------------------------------------

  /** Calcula a nova geometria respeitando os limites da área de trabalho. */
  private readonly onPointerMove = (event: PointerEvent): void => {
    const parent = this.host.nativeElement.parentElement;
    if (!this.action || !parent) return;

    const bounds = { w: parent.clientWidth, h: parent.clientHeight };
    const dx = event.clientX - this.start.px;
    const dy = event.clientY - this.start.py;
    const g = { ...this.start.geo };

    if (this.action === 'move') {
      g.x = clamp(g.x + dx, 0, Math.max(0, bounds.w - g.width));
      g.y = clamp(g.y + dy, 0, Math.max(0, bounds.h - HEADER_HEIGHT));
    }
    if (this.action === 'resize-e' || this.action === 'resize-se') {
      g.width = clamp(g.width + dx, MIN_WIDTH, bounds.w - g.x);
    }
    if (this.action === 'resize-s' || this.action === 'resize-se') {
      g.height = clamp(g.height + dy, MIN_HEIGHT, bounds.h - g.y);
    }

    this.geometry.set(g);
  };

  private readonly stopPointer = (): void => {
    this.action = null;
    document.body.style.userSelect = '';
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.stopPointer);
  };
}

/** Limita um valor ao intervalo [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
