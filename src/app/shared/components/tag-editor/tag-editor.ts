import { Component, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TAG_COLORS, Tag } from '../../../core/models/tag.model';
import { newId } from '../../../core/utils/id';
import { ColorPicker } from '../color-picker/color-picker';

/**
 * Lista editável de etiquetas: cor, texto e nível opcional (−/+).
 * Não grava nada sozinha — emite `changed` com a lista nova, e quem usa decide
 * onde gravar (token, ficha de personagem, cartão de item…).
 * O botão de adicionar fica com quem usa (cabeçalhos diferentes): chame `add()`.
 */
@Component({
  selector: 'app-tag-editor',
  imports: [MatIconModule, MatTooltipModule, ColorPicker],
  host: { class: 'flex flex-col gap-1.5' },
  template: `
    @for (tag of tags(); track tag.id) {
      <div class="flex items-center gap-1.5">
        <app-color-picker [value]="tag.color" [palette]="colors" label="Cor da etiqueta" (picked)="update(tag.id, { color: $event })" />
        <input
          #tagInput
          class="h-8 min-w-0 flex-1 rounded-md bg-ink-950 px-2 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-astral-500/60"
          [placeholder]="placeholder()"
          [value]="tag.text"
          (input)="update(tag.id, { text: tagInput.value })"
        />
        <!-- Nível (opcional) -->
        <div class="flex shrink-0 items-center rounded-md bg-ink-950 ring-1 ring-white/10" matTooltip="Nível (0 = sem nível)">
          <button type="button" class="grid size-7 place-items-center rounded-l-md text-slate-400 hover:bg-white/10 disabled:opacity-30" aria-label="Diminuir nível" [disabled]="!tag.level" (click)="stepLevel(tag, -1)">
            <mat-icon class="!text-[16px]">remove</mat-icon>
          </button>
          <span class="w-9 text-center text-xs tabular-nums" [class]="tag.level ? 'font-semibold text-star-300' : 'text-slate-600'">
            {{ tag.level ? 'Nv ' + tag.level : '—' }}
          </span>
          <button type="button" class="grid size-7 place-items-center rounded-r-md text-slate-400 hover:bg-white/10 disabled:opacity-30" aria-label="Aumentar nível" [disabled]="atMax(tag)" (click)="stepLevel(tag, 1)">
            <mat-icon class="!text-[16px]">add</mat-icon>
          </button>
        </div>
        <button type="button" class="grid size-7 shrink-0 place-items-center rounded-md text-slate-500 hover:bg-red-500/15 hover:text-red-300" aria-label="Remover etiqueta" (click)="remove(tag.id)">
          <mat-icon class="!text-[16px]">close</mat-icon>
        </button>
      </div>
    } @empty {
      <p class="text-xs text-slate-600">{{ emptyText() }}</p>
    }
  `,
})
export class TagEditor {
  readonly tags = input.required<Tag[]>();
  readonly placeholder = input('Ex.: Envenenado');
  readonly emptyText = input('Nenhuma etiqueta.');
  /** Nível máximo (ausente = sem limite). */
  readonly maxLevel = input<number>();

  /** Lista alterada. */
  readonly changed = output<Tag[]>();

  readonly colors = TAG_COLORS;

  /** Adiciona uma etiqueta nova no fim da lista. */
  add(text = 'Etiqueta'): void {
    this.changed.emit([...this.tags(), { id: newId(), text, color: TAG_COLORS[1] }]);
  }

  update(id: string, patch: Partial<Tag>): void {
    this.changed.emit(this.tags().map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  /** Botões −/+ do nível (0 remove o nível). */
  stepLevel(tag: Tag, delta: number): void {
    const max = this.maxLevel() ?? Infinity;
    const level = Math.min(max, Math.max(0, (tag.level ?? 0) + delta));
    this.update(tag.id, { level: level || undefined });
  }

  atMax(tag: Tag): boolean {
    return (tag.level ?? 0) >= (this.maxLevel() ?? Infinity);
  }

  remove(id: string): void {
    this.changed.emit(this.tags().filter((t) => t.id !== id));
  }
}
