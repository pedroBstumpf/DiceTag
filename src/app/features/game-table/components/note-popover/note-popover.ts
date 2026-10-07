import { Component, inject, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MapNote, NOTE_COLORS } from '../../../../core/models/table-session.model';
import { AutoFocus } from '../../../../shared/directives/auto-focus.directive';
import { TableSessionService } from '../../services/table-session.service';

/**
 * Popover compacto de uma anotação do mapa: título, texto, cor,
 * "Só o mestre vê" e excluir. Posicionado pelo map-stage junto ao marcador.
 * Mais leve que uma janela flutuante e sem os atalhos de teclado de um menu.
 */
@Component({
  selector: 'app-note-popover',
  imports: [MatIconModule, MatTooltipModule, AutoFocus],
  host: {
    class: 'glass block w-72 rounded-xl p-3 shadow-2xl shadow-black/60 animate-fade-in',
    // Cliques e rolagem aqui não chegam ao mapa
    '(pointerdown)': '$event.stopPropagation()',
    '(wheel)': '$event.stopPropagation()',
    '(keydown.escape)': 'closed.emit()',
  },
  template: `
    @let n = note();
    <div class="mb-2 flex items-center gap-1">
      <input
        #titleInput
        appAutoFocus
        class="h-8 min-w-0 flex-1 rounded-md bg-ink-950/80 px-2 font-display text-sm text-star-300 outline-none ring-1 ring-white/10 placeholder:text-slate-600 focus:ring-astral-500/60"
        placeholder="Título"
        [value]="n.title"
        (input)="update({ title: titleInput.value })"
      />
      <button type="button" class="grid size-8 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Fechar" (click)="closed.emit()">
        <mat-icon class="!text-[18px]">close</mat-icon>
      </button>
    </div>

    <textarea
      #textInput
      rows="4"
      class="mb-2 w-full resize-y rounded-md bg-ink-950/80 px-2 py-1.5 text-sm text-slate-200 outline-none ring-1 ring-white/10 placeholder:text-slate-600 focus:ring-astral-500/60"
      placeholder="O que há aqui? Armadilhas, segredos, descrição…"
      [value]="n.text"
      (input)="update({ text: textInput.value })"
    ></textarea>

    <div class="mb-3 flex items-center gap-1.5">
      @for (color of colors; track color) {
        <button
          type="button"
          class="size-5 rounded-full ring-offset-2 ring-offset-ink-900 transition-transform hover:scale-110"
          [class.ring-2]="n.color === color"
          [style.background]="color"
          [style.--tw-ring-color]="color"
          [attr.aria-label]="'Cor ' + color"
          (click)="update({ color })"
        ></button>
      }
    </div>

    <div class="flex items-center justify-between border-t border-white/5 pt-2">
      <button
        type="button"
        role="switch"
        class="flex items-center gap-1.5 text-xs text-slate-300 hover:text-white"
        [attr.aria-checked]="n.gmOnly"
        (click)="update({ gmOnly: !n.gmOnly })"
      >
        <mat-icon class="!size-5 !text-[20px]" [class.text-astral-300]="n.gmOnly">{{ n.gmOnly ? 'check_box' : 'check_box_outline_blank' }}</mat-icon>
        Só o mestre vê
      </button>
      <button
        type="button"
        class="grid size-8 place-items-center rounded-md text-slate-500 hover:bg-red-500/15 hover:text-red-300"
        matTooltip="Excluir anotação"
        (click)="remove()"
      >
        <mat-icon class="!text-[18px]">delete</mat-icon>
      </button>
    </div>
  `,
})
export class NotePopover {
  private readonly session = inject(TableSessionService);

  readonly note = input.required<MapNote>();
  readonly closed = output<void>();

  readonly colors = NOTE_COLORS;

  update(patch: Partial<Omit<MapNote, 'id'>>): void {
    this.session.updateNote(this.note().id, patch);
  }

  remove(): void {
    this.session.removeNote(this.note().id);
    this.closed.emit();
  }
}
