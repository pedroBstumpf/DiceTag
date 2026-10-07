import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { Component, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TIMELINE_COLORS, TimelineEvent } from '../../../../core/models/world-item.model';
import { newId } from '../../../../core/utils/id';
import { AutoFocus } from '../../../../shared/directives/auto-focus.directive';
import { WorldbuildService } from '../../services/worldbuild.service';

/**
 * Editor de linha do tempo.
 * Eventos com data em texto livre (calendários de fantasia), descrição e cor.
 * A ordem é manual: arraste pela alça para reorganizar.
 */
@Component({
  selector: 'app-timeline-editor',
  imports: [CdkDropList, CdkDrag, CdkDragHandle, MatButtonModule, MatIconModule, MatTooltipModule, AutoFocus],
  templateUrl: './timeline-editor.html',
  host: { class: 'flex h-full flex-col' },
})
export class TimelineEditor {
  private readonly service = inject(WorldbuildService);

  readonly itemId = input.required<string>();
  readonly events = computed(() => this.service.byId().get(this.itemId())?.events ?? []);

  readonly colors = TIMELINE_COLORS;
  /** Evento em edição (formulário aberto). */
  readonly editingId = signal<string | null>(null);

  // --- Ações ---------------------------------------------------------------

  add(): void {
    const event: TimelineEvent = {
      id: newId(),
      title: '',
      date: '',
      description: '',
      color: TIMELINE_COLORS[this.events().length % TIMELINE_COLORS.length],
    };
    this.save([...this.events(), event]);
    this.editingId.set(event.id);
  }

  /** Atualiza um campo de um evento. */
  change(id: string, patch: Partial<TimelineEvent>): void {
    this.save(this.events().map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  remove(id: string): void {
    this.save(this.events().filter((e) => e.id !== id));
    if (this.editingId() === id) this.editingId.set(null);
  }

  /** Abre/fecha o formulário de um evento. */
  toggleEdit(id: string): void {
    this.editingId.update((current) => (current === id ? null : id));
  }

  reorder(drop: CdkDragDrop<TimelineEvent[]>): void {
    const list = [...this.events()];
    moveItemInArray(list, drop.previousIndex, drop.currentIndex);
    this.save(list);
  }

  private save(events: TimelineEvent[]): void {
    this.service.update(this.itemId(), { events });
  }
}
