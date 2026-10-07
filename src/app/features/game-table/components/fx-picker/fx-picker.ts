import { Component, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DEFAULT_FX, FX_COLORS, FX_GROUPS, FX_KINDS, FxGroup, FxStyle } from '../../../../core/models/table-session.model';

/**
 * Escolha de efeito especial: forma (corte, explosão, jato…) e cor do elemento.
 * Não grava nada — emite `picked`; usado no submenu da ferramenta Efeitos
 * e na configuração das automações.
 */
@Component({
  selector: 'app-fx-picker',
  imports: [MatIconModule, MatTooltipModule],
  host: { class: 'flex flex-col gap-3' },
  template: `
    @let v = value() ?? fallback;
    <!-- Formas, por grupo -->
    @for (group of groups; track group) {
      <div>
        <span class="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-slate-500">{{ group }}</span>
        <div class="grid grid-cols-3 gap-1">
          @for (k of kindsOf(group); track k.id) {
            <button
              type="button"
              class="flex h-11 flex-col items-center justify-center gap-0.5 rounded-md text-[10px] leading-none transition-colors"
              [class]="v.kind === k.id ? 'bg-astral-500/25 text-astral-300 ring-1 ring-astral-400/50' : 'bg-white/5 text-slate-300 hover:bg-white/10'"
              [matTooltip]="k.hint"
              (click)="picked.emit({ kind: k.id, color: v.color })"
            >
              <mat-icon class="!size-[18px] !text-[18px]" [style.color]="v.kind === k.id ? v.color : null">{{ k.icon }}</mat-icon>
              {{ k.label }}
            </button>
          }
        </div>
      </div>
    }

    <!-- Cores (elementos) -->
    <div class="flex flex-wrap gap-1.5">
      @for (c of colors; track c.color) {
        <button
          type="button"
          class="size-6 rounded-full ring-1 ring-white/20 ring-offset-2 ring-offset-ink-900 transition-transform hover:scale-110"
          [class.!ring-2]="v.color === c.color"
          [class.!ring-astral-300]="v.color === c.color"
          [style.background]="c.color"
          [style.box-shadow]="v.color === c.color ? '0 0 10px ' + c.color : null"
          [matTooltip]="c.label"
          [attr.aria-label]="c.label"
          (click)="picked.emit({ kind: v.kind, color: c.color })"
        ></button>
      }
    </div>
  `,
})
export class FxPicker {
  /** Efeito atual (null = nenhum escolhido; mostra o padrão sem destaque). */
  readonly value = input<FxStyle | null>(null);
  readonly picked = output<FxStyle>();

  readonly groups = FX_GROUPS;
  readonly colors = FX_COLORS;
  readonly fallback = DEFAULT_FX;

  kindsOf(group: FxGroup) {
    return FX_KINDS.filter((k) => k.group === group);
  }
}
