import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TableSessionService } from '../../services/table-session.service';

/** Reprodutor de um som da mesa (trilha ou ambiente), com repetição. */
@Component({
  selector: 'app-sound-player',
  imports: [MatIconModule, MatTooltipModule],
  host: { class: 'flex h-full flex-col items-center justify-center gap-4 p-5' },
  template: `
    <div class="grid size-16 place-items-center rounded-xl bg-cyan-400/10 text-cyan-300 ring-1 ring-cyan-300/20">
      <mat-icon class="!size-8 !text-[32px]">graphic_eq</mat-icon>
    </div>
    @if (src(); as url) {
      <audio class="w-full [color-scheme:dark]" controls [loop]="loop()" [src]="url"></audio>
    } @else {
      <p class="text-sm text-slate-500">Carregando áudio…</p>
    }
    <button
      type="button"
      class="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors"
      [class]="loop() ? 'bg-astral-500/20 text-astral-300' : 'text-slate-400 hover:bg-white/5'"
      (click)="loop.set(!loop())"
    >
      <mat-icon class="!text-[18px]">repeat</mat-icon>
      Repetir {{ loop() ? '(ligado)' : '(desligado)' }}
    </button>
  `,
})
export class SoundPlayer {
  private readonly session = inject(TableSessionService);

  readonly entryId = input.required<string>();
  readonly src = signal<string | null>(null);
  /** Ambientes costumam tocar em repetição. */
  readonly loop = signal(true);

  private readonly blobId = computed(() => this.session.entryById().get(this.entryId())?.blobId);

  constructor() {
    // Carrega o arquivo do IndexedDB e cria uma URL temporária
    effect(async (onCleanup) => {
      const blobId = this.blobId();
      if (!blobId) return;
      // Cancela este carregamento se o arquivo mudar (ou a janela fechar) antes de terminar
      let url: string | undefined;
      let cancelled = false;
      onCleanup(() => {
        cancelled = true;
        if (url) URL.revokeObjectURL(url);
      });
      const blob = await this.session.getBlob(blobId);
      if (cancelled || !blob) return;
      url = URL.createObjectURL(blob);
      this.src.set(url);
    });
  }
}
