import { Component, computed, input, output } from '@angular/core';
import { SHEET_MAX_LEVEL } from '../../../../core/models/table-session.model';

/**
 * Seletor de nível em losangos (padrão: 1 a 6), usado nas relações e nas tags
 * de tema da ficha. Clicar num losango define o nível; os anteriores acendem.
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
        [attr.aria-checked]="n === value()"
        [attr.aria-label]="'Nível ' + n"
        [title]="'Nível ' + n"
        (click)="picked.emit(n)"
      >
        <span
          class="size-2.5 rotate-45 transition-colors"
          [class]="n <= value() ? 'bg-astral-300 shadow-[0_0_6px_rgb(122_167_255)]' : 'bg-white/10 ring-1 ring-white/20 hover:bg-astral-500/40'"
        ></span>
      </button>
    }
    <span class="ml-1 w-4 text-center text-xs font-semibold tabular-nums text-star-300">{{ value() }}</span>
  `,
})
export class LevelPips {
  readonly value = input.required<number>();
  readonly max = input(SHEET_MAX_LEVEL);
  readonly label = input('Nível');
  readonly picked = output<number>();

  readonly levels = computed(() => Array.from({ length: this.max() }, (_, i) => i + 1));
}
