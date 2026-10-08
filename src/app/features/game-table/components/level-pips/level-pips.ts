import { Component, computed, input, output } from '@angular/core';
import { SHEET_MAX_LEVEL } from '../../../../core/models/table-session.model';

/**
 * Seletor de nível em losangos (padrão: 1 a 6), usado nas relações e nas tags
 * de tema da ficha. Clicar num losango define o nível; os anteriores acendem.
 * `negative` (defeitos): os mesmos losangos, em vermelho, valendo -1 a -6.
 */
@Component({
  selector: 'app-level-pips',
  host: { class: 'inline-flex shrink-0 items-center gap-0.5', role: 'radiogroup', '[attr.aria-label]': 'label()' },
  template: `
    @for (n of levels(); track n) {
      <button
        type="button"
        role="radio"
        class="grid size-5 place-items-center"
        [attr.aria-checked]="n === size()"
        [attr.aria-label]="'Nível ' + signed(n)"
        [title]="'Nível ' + signed(n)"
        (click)="picked.emit(signed(n))"
      >
        <span class="size-2.5 rotate-45 transition-colors" [class]="pipClass(n)"></span>
      </button>
    }
    <span class="ml-1 w-5 text-center text-xs font-semibold tabular-nums" [class]="negative() ? 'text-red-300' : 'text-star-300'">
      {{ value() }}
    </span>
  `,
})
export class LevelPips {
  /** Nível atual (negativo quando `negative`). */
  readonly value = input.required<number>();
  readonly max = input(SHEET_MAX_LEVEL);
  /** Níveis negativos (defeitos): -1 a -max. */
  readonly negative = input(false);
  readonly label = input('Nível');
  readonly picked = output<number>();

  readonly levels = computed(() => Array.from({ length: this.max() }, (_, i) => i + 1));
  /** Quantos losangos acesos. */
  readonly size = computed(() => Math.abs(this.value()));

  /** Valor do losango n com o sinal do modo. */
  signed(n: number): number {
    return this.negative() ? -n : n;
  }

  pipClass(n: number): string {
    if (n > this.size()) return 'bg-white/10 ring-1 ring-white/20 hover:bg-white/25';
    return this.negative() ? 'bg-red-400 shadow-[0_0_6px_rgb(248_113_113)]' : 'bg-astral-300 shadow-[0_0_6px_rgb(122_167_255)]';
  }
}
