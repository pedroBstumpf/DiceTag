import { Component, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TableSessionService, WallMode } from '../../services/table-session.service';

/** Modos de parede exibidos no submenu. */
const WALL_MODES: { id: WallMode; icon: string; label: string; hint: string }[] = [
  { id: 'line', icon: 'polyline', label: 'Parede — linha (W)', hint: 'Clique ponto a ponto. Enter, duplo clique ou clicar no início finaliza; Esc cancela. Shift: sem grade.' },
  { id: 'circle', icon: 'circle', label: 'Parede — círculo', hint: 'Arraste do centro para definir o raio (pilares, árvores).' },
  { id: 'door', icon: 'door_front', label: 'Porta', hint: 'Arraste de um batente ao outro. Com a ferramenta Selecionar, clique no ícone da porta para abrir ou fechar.' },
  { id: 'edit', icon: 'open_with', label: 'Editar paredes', hint: 'Clique numa parede para selecionar. Arraste o corpo para mover tudo ou um ponto para movê-lo. Delete remove.' },
  { id: 'erase', icon: 'ink_eraser', label: 'Apagar parede', hint: 'Clique numa parede para removê-la.' },
];

/**
 * Submenu da ferramenta Névoa de guerra (ao lado da barra de ferramentas):
 * liga/desliga a névoa na cena, escolhe o modo de parede e a visibilidade das paredes.
 */
@Component({
  selector: 'app-fog-menu',
  imports: [MatIconModule, MatTooltipModule],
  host: { class: 'glass block w-64 rounded-xl p-2 shadow-xl shadow-black/40' },
  template: `
    <h4 class="px-2 pb-2 pt-1 font-display text-sm tracking-wide text-star-300">Névoa de guerra</h4>

    <!-- Liga/desliga na cena ativa -->
    <button
      type="button"
      role="switch"
      class="mb-2 flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-40"
      [attr.aria-checked]="session.fogEnabled()"
      [disabled]="!session.activeScene()"
      (click)="session.setFog(!session.fogEnabled())"
    >
      Névoa nesta cena
      <span class="relative h-5 w-9 shrink-0 rounded-full transition-colors" [class]="session.fogEnabled() ? 'bg-astral-500' : 'bg-ink-600'">
        <span class="absolute top-0.5 size-4 rounded-full bg-white transition-all" [class]="session.fogEnabled() ? 'left-[18px]' : 'left-0.5'"></span>
      </span>
    </button>

    <!-- Memória: áreas já vistas continuam reveladas (escurecidas) -->
    <div class="mb-2 flex items-center gap-1">
      <button
        type="button"
        role="switch"
        class="flex flex-1 items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs text-slate-300 hover:bg-white/5 hover:text-white disabled:opacity-40"
        [attr.aria-checked]="session.fogMemory()"
        [disabled]="!session.activeScene()"
        (click)="session.setFogMemory(!session.fogMemory())"
      >
        <mat-icon class="!size-5 !text-[20px]" [class.text-astral-300]="session.fogMemory()">
          {{ session.fogMemory() ? 'check_box' : 'check_box_outline_blank' }}
        </mat-icon>
        Lembrar áreas exploradas
      </button>
      <button
        type="button"
        class="grid size-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-40"
        matTooltip="Esquecer áreas exploradas desta cena"
        [disabled]="!session.activeScene()"
        (click)="forget()"
      >
        <mat-icon class="!text-[18px]">history_toggle_off</mat-icon>
      </button>
    </div>

    <!-- Modos de parede -->
    <div class="flex flex-col gap-0.5 border-t border-white/5 pt-2">
      @for (mode of modes; track mode.id) {
        <button
          type="button"
          class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors"
          [class]="session.wallMode() === mode.id ? 'bg-astral-500/20 text-astral-300' : 'text-slate-300 hover:bg-white/5'"
          (click)="session.wallMode.set(mode.id)"
        >
          <mat-icon class="!size-5 !text-[20px]">{{ mode.icon }}</mat-icon>
          {{ mode.label }}
        </button>
      }
    </div>
    <p class="px-2 py-2 text-[11px] leading-relaxed text-slate-500">{{ hint() }}</p>

    <!-- Visibilidade das paredes -->
    <button
      type="button"
      role="switch"
      class="flex w-full items-center justify-between gap-2 rounded-lg border-t border-white/5 px-2 pb-1 pt-2 text-left text-xs text-slate-300 hover:text-white"
      [attr.aria-checked]="session.showWallsAlways()"
      (click)="session.showWallsAlways.set(!session.showWallsAlways())"
    >
      Mostrar paredes sempre (só mestre)
      <mat-icon class="!size-5 shrink-0 !text-[20px]" [class.text-astral-300]="session.showWallsAlways()">
        {{ session.showWallsAlways() ? 'check_box' : 'check_box_outline_blank' }}
      </mat-icon>
    </button>
  `,
})
export class FogMenu {
  readonly session = inject(TableSessionService);
  readonly modes = WALL_MODES;

  hint(): string {
    return WALL_MODES.find((m) => m.id === this.session.wallMode())?.hint ?? '';
  }

  forget(): void {
    if (confirm('Esquecer as áreas já exploradas nesta cena?')) this.session.clearExplored();
  }
}
