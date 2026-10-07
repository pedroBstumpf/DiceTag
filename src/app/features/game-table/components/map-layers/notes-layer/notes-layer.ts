import { Component, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MapNote } from '../../../../../core/models/table-session.model';

/** Ponteiro pressionado sobre um marcador de anotação. */
export interface NotePointerDown {
  event: PointerEvent;
  note: MapNote;
}

/**
 * Camada de anotações (dentro do "mundo", abaixo da névoa).
 * Cada anotação é um marcador (pin) de tamanho constante na tela, com a
 * ponta no ponto do mapa; o hover mostra o título. Só avisa o ponteiro —
 * mover e abrir a edição é roteado pelo map-stage.
 */
@Component({
  selector: 'app-notes-layer',
  imports: [MatIconModule, MatTooltipModule],
  host: { class: 'pointer-events-none absolute left-0 top-0' },
  template: `
    @for (note of notes(); track note.id) {
      <!-- Escala inversa: o marcador fica do mesmo tamanho em qualquer zoom -->
      <div
        class="absolute origin-bottom"
        [style.left.px]="note.x"
        [style.top.px]="note.y"
        [style.transform]="'translate(-50%, -100%) ' + upright() + ' scale(' + 1 / scale() + ')'"
      >
        <button
          type="button"
          class="relative grid place-items-center drop-shadow-[0_2px_4px_rgb(0_0_0/0.8)] transition-transform hover:scale-110"
          [class]="interactive() ? 'pointer-events-auto cursor-pointer' : 'pointer-events-none'"
          [class.scale-125]="activeId() === note.id"
          [style.color]="note.color"
          [matTooltip]="note.title || 'Anotação sem título'"
          matTooltipPosition="above"
          [attr.aria-label]="note.title || 'Anotação'"
          (pointerdown)="onDown($event, note)"
        >
          <mat-icon class="icon-filled !size-9 !text-[36px]">location_on</mat-icon>
          <!-- Cadeado: só o mestre vê -->
          @if (note.gmOnly) {
            <mat-icon class="icon-filled absolute -right-1 -top-1 !size-4 rounded-full bg-ink-950 !text-[12px] leading-4 text-star-300">lock</mat-icon>
          }
        </button>
      </div>
    }
  `,
})
export class NotesLayer {
  readonly notes = input.required<MapNote[]>();
  readonly scale = input.required<number>();
  /** Marcadores recebem o ponteiro (ferramentas Selecionar e Anotação). */
  readonly interactive = input(false);
  /** Anotação com a edição aberta (marcador em destaque). */
  readonly activeId = input<string | null>(null);
  /** Vista isométrica: deixa o marcador "em pé" (vazio na 2D). */
  readonly upright = input('');

  readonly noteDown = output<NotePointerDown>();

  onDown(event: PointerEvent, note: MapNote): void {
    if (event.button !== 0) return;
    event.stopPropagation();
    this.noteDown.emit({ event, note });
  }
}
