import { Component, input, output } from '@angular/core';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';

/**
 * Seletor de cor compacto: uma bolinha com a cor atual que abre uma paleta.
 * Clicar numa cor da paleta escolhe e fecha; "Outra cor" abre o seletor
 * nativo do sistema (o menu continua aberto até clicar fora).
 */
@Component({
  selector: 'app-color-picker',
  imports: [MatMenuModule, MatTooltipModule],
  host: { class: 'inline-flex' },
  template: `
    <button
      type="button"
      class="size-6 shrink-0 rounded-full ring-1 ring-white/25 transition-transform hover:scale-110"
      [style.background]="value()"
      [matTooltip]="label()"
      [attr.aria-label]="label()"
      [matMenuTriggerFor]="menu"
    ></button>

    <mat-menu #menu="matMenu">
      <div class="grid grid-cols-5 gap-1.5 px-3 py-2">
        @for (color of palette(); track color) {
          <button
            type="button"
            class="size-7 rounded-full ring-offset-2 ring-offset-ink-800 transition-transform hover:scale-110"
            [class.ring-2]="color === value()"
            [style.background]="color"
            [style.--tw-ring-color]="color"
            [attr.aria-label]="'Cor ' + color"
            (click)="picked.emit(color)"
          ></button>
        }
      </div>
      <!-- Cor livre: não fecha o menu ao clicar (o seletor nativo precisa do campo vivo) -->
      <label class="flex cursor-pointer items-center gap-2 border-t border-white/5 px-3 py-2 text-xs text-slate-300 hover:text-white" (click)="$event.stopPropagation()">
        <input
          #custom
          type="color"
          class="size-6 cursor-pointer rounded border-0 bg-transparent p-0"
          [value]="value()"
          (input)="picked.emit(custom.value)"
        />
        Outra cor…
      </label>
    </mat-menu>
  `,
})
export class ColorPicker {
  /** Cor atual (hex). */
  readonly value = input.required<string>();
  /** Cores oferecidas na paleta. */
  readonly palette = input.required<readonly string[]>();
  readonly label = input('Escolher cor');

  /** Cor escolhida pelo usuário. */
  readonly picked = output<string>();
}
