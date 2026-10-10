import { Component, computed, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FX_COLORS, FX_KINDS, FixedFx } from '../../../../core/models/table-session.model';
import { TableSessionService } from '../../services/table-session.service';
import { FxPicker } from '../fx-picker/fx-picker';

/**
 * Submenu da ferramenta Efeitos especiais (ao lado da barra de ferramentas):
 * forma e cor do efeito. Arrastar no mapa lança o efeito.
 * "Fixar no mapa" faz os próximos efeitos ficarem na cena, repetindo, até serem removidos
 * (lista abaixo: quem lançou e o mestre removem).
 */
@Component({
  selector: 'app-fx-menu',
  imports: [MatIconModule, MatTooltipModule, FxPicker],
  host: { class: 'glass block max-h-[calc(100dvh-8rem)] w-64 overflow-y-auto rounded-xl p-3 shadow-xl shadow-black/40' },
  template: `
    <h4 class="pb-2 font-display text-sm tracking-wide text-star-300">Efeitos especiais</h4>
    <app-fx-picker [value]="session.fxStyle()" (picked)="session.fxStyle.set($event)" />
    <p class="pt-3 text-[11px] leading-relaxed text-slate-500">{{ hint() }}</p>

    <!-- Fixar no mapa: os próximos efeitos ficam na cena, repetindo -->
    <button
      type="button"
      role="switch"
      class="mt-3 flex items-center gap-2 text-xs text-slate-200"
      [attr.aria-checked]="session.fxFixed()"
      (click)="session.fxFixed.set(!session.fxFixed())"
    >
      <span class="relative h-5 w-9 rounded-full transition-colors" [class]="session.fxFixed() ? 'bg-astral-500' : 'bg-ink-600'">
        <span class="absolute top-0.5 size-4 rounded-full bg-white transition-all" [class]="session.fxFixed() ? 'left-[18px]' : 'left-0.5'"></span>
      </span>
      Fixar no mapa
    </button>
    <p class="pt-1 text-[11px] leading-relaxed text-slate-500">
      {{ session.fxFixed() ? 'Os próximos efeitos ficam no mapa, repetindo, até serem removidos.' : 'Desligado: o efeito aparece uma vez e some.' }}
    </p>

    <!-- Efeitos fixos da camada em foco -->
    @if (session.fixedFxList().length) {
      <div class="mt-3 border-t border-white/5 pt-2">
        <div class="mb-1 flex items-center justify-between">
          <h5 class="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Fixos no mapa · {{ session.fixedFxList().length }}</h5>
          @if (canClear()) {
            <button type="button" class="rounded px-1.5 py-0.5 text-[11px] text-slate-400 hover:bg-white/5 hover:text-red-300" (click)="session.clearFixedFx()">
              Remover todos
            </button>
          }
        </div>
        @for (fx of session.fixedFxList(); track fx.id) {
          <div class="flex h-8 items-center gap-2 rounded-md px-1 text-xs text-slate-300">
            <mat-icon class="!size-4 !text-[16px]" [style.color]="fx.color">{{ iconOf(fx) }}</mat-icon>
            <span class="min-w-0 flex-1 truncate">{{ labelOf(fx) }}</span>
            @if (session.canRemoveFixedFx(fx)) {
              <button
                type="button"
                class="grid size-6 place-items-center rounded text-slate-500 hover:bg-white/10 hover:text-red-300"
                matTooltip="Remover do mapa"
                [attr.aria-label]="'Remover ' + labelOf(fx)"
                (click)="session.removeFixedFx(fx.id)"
              >
                <mat-icon class="!text-[14px]">close</mat-icon>
              </button>
            }
          </div>
        }
      </div>
    }
  `,
})
export class FxMenu {
  readonly session = inject(TableSessionService);

  /** Como lançar a forma escolhida. */
  readonly hint = computed(() => {
    const kind = FX_KINDS.find((k) => k.id === this.session.fxStyle().kind);
    return `${kind?.hint ?? 'Arraste no mapa'}. A cor representa o elemento.`;
  });

  /** Há algum efeito fixo que a conta pode remover. */
  readonly canClear = computed(() => this.session.fixedFxList().some((f) => this.session.canRemoveFixedFx(f)));

  iconOf(fx: FixedFx): string {
    return FX_KINDS.find((k) => k.id === fx.kind)?.icon ?? 'auto_awesome';
  }

  /** "Bola de fogo · Fogo". */
  labelOf(fx: FixedFx): string {
    const kind = FX_KINDS.find((k) => k.id === fx.kind)?.label ?? 'Efeito';
    const element = FX_COLORS.find((c) => c.color === fx.color)?.label;
    return element ? `${kind} · ${element}` : kind;
  }
}
