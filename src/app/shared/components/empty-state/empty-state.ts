import { Component, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';

/**
 * Bloco de "estado vazio" padronizado: ícone, título, texto e
 * espaço para ações (botões projetados via <ng-content>).
 */
@Component({
  selector: 'app-empty-state',
  imports: [MatIcon],
  host: { class: 'flex flex-col items-center justify-center gap-3 px-6 py-12 text-center' },
  template: `
    <div class="grid size-16 place-items-center rounded-2xl bg-ink-800 ring-1 ring-white/5">
      <mat-icon class="!size-8 !text-[32px] text-astral-300">{{ icon() }}</mat-icon>
    </div>
    <h3 class="font-display text-lg text-slate-100">{{ title() }}</h3>
    @if (message()) {
      <p class="max-w-sm text-sm leading-relaxed text-slate-400">{{ message() }}</p>
    }
    <div class="mt-2 flex flex-wrap justify-center gap-2">
      <ng-content />
    </div>
  `,
})
export class EmptyState {
  readonly icon = input('inbox');
  readonly title = input.required<string>();
  readonly message = input('');
}
