import { Component, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { BRUSH_COLORS, BRUSH_OPACITIES, BRUSH_WIDTHS } from '../../../../core/models/table-session.model';
import { Brush, TableSessionService } from '../../services/table-session.service';

/**
 * Submenu da ferramenta Desenhar (ao lado da barra de ferramentas):
 * cor, espessura, opacidade, borracha e limpar os desenhos da cena.
 */
@Component({
  selector: 'app-draw-menu',
  imports: [MatIconModule, MatTooltipModule],
  host: { class: 'glass block w-60 rounded-xl p-3 shadow-xl shadow-black/40' },
  template: `
    @let brush = session.brush();
    <h4 class="pb-2 font-display text-sm tracking-wide text-star-300">Pincel</h4>

    <!-- Cores -->
    <div class="mb-3 grid grid-cols-8 gap-1">
      @for (color of colors; track color) {
        <button
          type="button"
          class="size-6 rounded-full ring-1 ring-white/20 ring-offset-2 ring-offset-ink-900 transition-transform hover:scale-110"
          [class.!ring-2]="!brush.eraser && brush.color === color"
          [class.!ring-astral-300]="!brush.eraser && brush.color === color"
          [style.background]="color"
          [attr.aria-label]="'Cor ' + color"
          (click)="set({ color, eraser: false })"
        ></button>
      }
    </div>

    <!-- Espessura -->
    <span class="mb-1 block text-[11px] text-slate-400">Espessura</span>
    <div class="mb-3 flex gap-1">
      @for (width of widths; track width) {
        <button
          type="button"
          class="grid h-8 flex-1 place-items-center rounded-md transition-colors"
          [class]="brush.width === width ? 'bg-astral-500/25 ring-1 ring-astral-400/50' : 'bg-white/5 hover:bg-white/10'"
          [attr.aria-label]="'Espessura ' + width"
          (click)="set({ width })"
        >
          <span class="rounded-full bg-slate-200" [style.width.px]="dot(width)" [style.height.px]="dot(width)"></span>
        </button>
      }
    </div>

    <!-- Opacidade -->
    <span class="mb-1 block text-[11px] text-slate-400">Opacidade</span>
    <div class="mb-3 flex gap-1">
      @for (opacity of opacities; track opacity) {
        <button
          type="button"
          class="h-8 flex-1 rounded-md text-xs font-semibold transition-colors"
          [class]="brush.opacity === opacity ? 'bg-astral-500/25 text-astral-300 ring-1 ring-astral-400/50' : 'bg-white/5 text-slate-300 hover:bg-white/10'"
          (click)="set({ opacity })"
        >
          {{ percent(opacity) }}%
        </button>
      }
    </div>

    <!-- Borracha e limpar -->
    <div class="flex gap-1 border-t border-white/5 pt-3">
      <button
        type="button"
        class="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-xs font-semibold transition-colors"
        [class]="brush.eraser ? 'bg-astral-500/25 text-astral-300 ring-1 ring-astral-400/50' : 'bg-white/5 text-slate-300 hover:bg-white/10'"
        [attr.aria-pressed]="brush.eraser"
        (click)="set({ eraser: !brush.eraser })"
      >
        <mat-icon class="!size-4 !text-[16px]">ink_eraser</mat-icon>
        Borracha
      </button>
      <button
        type="button"
        class="grid h-8 w-9 place-items-center rounded-md bg-white/5 text-slate-400 transition-colors hover:bg-red-500/15 hover:text-red-300 disabled:opacity-40"
        matTooltip="Limpar desenhos da cena"
        [disabled]="!session.drawings().length"
        (click)="clear()"
      >
        <mat-icon class="!size-4 !text-[16px]">delete_sweep</mat-icon>
      </button>
    </div>
    <p class="pt-2 text-[11px] text-slate-500">Ctrl+Z desfaz o último traço.</p>
  `,
})
export class DrawMenu {
  readonly session = inject(TableSessionService);
  readonly colors = BRUSH_COLORS;
  readonly widths = BRUSH_WIDTHS;
  readonly opacities = BRUSH_OPACITIES;

  set(patch: Partial<Brush>): void {
    this.session.brush.update((b) => ({ ...b, ...patch }));
  }

  percent(opacity: number): number {
    return Math.round(opacity * 100);
  }

  /** Tamanho da bolinha que representa a espessura no botão. */
  dot(width: number): number {
    return Math.min(18, 3 + width / 2);
  }

  clear(): void {
    if (confirm('Limpar todos os desenhos desta cena?')) this.session.clearDrawings();
  }
}
