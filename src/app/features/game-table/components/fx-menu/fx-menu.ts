import { Component, computed, inject } from '@angular/core';
import { FX_KINDS } from '../../../../core/models/table-session.model';
import { TableSessionService } from '../../services/table-session.service';
import { FxPicker } from '../fx-picker/fx-picker';

/**
 * Submenu da ferramenta Efeitos especiais (ao lado da barra de ferramentas):
 * forma e cor do efeito. Arrastar no mapa lança o efeito.
 */
@Component({
  selector: 'app-fx-menu',
  imports: [FxPicker],
  host: { class: 'glass block max-h-[calc(100dvh-8rem)] w-64 overflow-y-auto rounded-xl p-3 shadow-xl shadow-black/40' },
  template: `
    <h4 class="pb-2 font-display text-sm tracking-wide text-star-300">Efeitos especiais</h4>
    <app-fx-picker [value]="session.fxStyle()" (picked)="session.fxStyle.set($event)" />
    <p class="pt-3 text-[11px] leading-relaxed text-slate-500">{{ hint() }}</p>
  `,
})
export class FxMenu {
  readonly session = inject(TableSessionService);

  /** Como lançar a forma escolhida. */
  readonly hint = computed(() => {
    const kind = FX_KINDS.find((k) => k.id === this.session.fxStyle().kind);
    return `${kind?.hint ?? 'Arraste no mapa'}. A cor representa o elemento.`;
  });
}
