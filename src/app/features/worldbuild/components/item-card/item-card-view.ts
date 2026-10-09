import { Component, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Tag } from '../../../../core/models/tag.model';
import { TagEditor } from '../../../../shared/components/tag-editor/tag-editor';

/** Cor padrão das etiquetas de item (verde). */
export const ITEM_TAG_COLOR = '#22c55e';

/**
 * Cartão de item só de apresentação: imagem, nome, descrição e etiquetas.
 * Não sabe de onde vêm os dados — emite as alterações e quem usa grava:
 * o item do worldbuild (ItemCard) ou a cópia do item no inventário da ficha.
 */
@Component({
  selector: 'app-item-card-view',
  imports: [MatIconModule, TagEditor],
  host: { class: 'block' },
  template: `
    <article class="mx-auto flex max-w-sm flex-col overflow-hidden rounded-xl bg-gradient-to-b from-ink-800 to-ink-900 shadow-lg shadow-black/40 ring-1 ring-astral-400/25">
      <!-- Imagem do item -->
      <div class="relative aspect-[4/3] w-full bg-ink-950">
        @if (imageUrl(); as url) {
          <img [src]="url" alt="" class="size-full object-cover" />
        } @else {
          <div class="grid size-full place-items-center text-slate-600">
            <mat-icon class="!size-12 !text-[48px]">inventory_2</mat-icon>
          </div>
        }
        <button
          type="button"
          class="absolute inset-0 grid place-items-center bg-black/60 text-white opacity-0 transition-opacity hover:opacity-100 focus:opacity-100"
          [attr.aria-label]="imageUrl() ? 'Trocar imagem' : 'Enviar imagem'"
          (click)="imageInput.click()"
        >
          <span class="flex flex-col items-center gap-1 text-xs">
            <mat-icon>add_photo_alternate</mat-icon>
            {{ imageUrl() ? 'Trocar imagem' : 'Enviar imagem' }}
          </span>
        </button>
        <input #imageInput type="file" accept="image/*" hidden (change)="onImagePicked(imageInput)" />
      </div>

      <div class="flex flex-col gap-3 border-t border-astral-400/20 p-4">
        <!-- Nome -->
        <input
          #nameInput
          class="w-full bg-transparent font-display text-xl text-star-300 outline-none placeholder:text-slate-600"
          placeholder="Nome do item"
          aria-label="Nome do item"
          [value]="name()"
          (blur)="rename(nameInput.value)"
          (keydown.enter)="nameInput.blur()"
        />

        <!-- Descrição (grava ao sair do campo) -->
        <textarea
          #descInput
          rows="3"
          class="w-full resize-y rounded-md bg-ink-950/70 px-2.5 py-2 text-sm leading-relaxed text-slate-200 outline-none ring-1 ring-white/10 placeholder:text-slate-600 focus:ring-astral-500/60"
          placeholder="Descrição do item"
          aria-label="Descrição do item"
          [value]="description()"
          (blur)="describe(descInput.value)"
        ></textarea>

        <!-- Etiquetas (novas começam verdes) -->
        <div>
          <div class="mb-2 flex items-center justify-between">
            <h4 class="text-xs text-slate-400">Etiquetas</h4>
            <button type="button" class="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-astral-300 hover:bg-white/5" (click)="tagEditor.add()">
              <mat-icon class="!size-4 !text-[16px]">add</mat-icon>
              Etiqueta
            </button>
          </div>
          <app-tag-editor
            #tagEditor
            [tags]="tags()"
            [defaultColor]="tagColor"
            placeholder="Ex.: Mágico"
            emptyText="Ex.: Arma, Mágico, Consumível."
            (changed)="tagsChange.emit($event)"
          />
        </div>
      </div>
    </article>
  `,
})
export class ItemCardView {
  readonly name = input.required<string>();
  readonly tags = input.required<Tag[]>();
  /** URL da imagem (null = sem imagem ou carregando). */
  readonly imageUrl = input<string | null>(null);
  /** Descrição do item (texto livre). */
  readonly description = input('');

  /** Nome novo (já sem espaços nas pontas; vazio é ignorado). */
  readonly renamed = output<string>();
  /** Descrição nova (emitida ao sair do campo, só se mudou). */
  readonly descriptionChange = output<string>();
  readonly tagsChange = output<Tag[]>();
  readonly imagePicked = output<File>();

  readonly tagColor = ITEM_TAG_COLOR;

  rename(value: string): void {
    const trimmed = value.trim();
    if (trimmed && trimmed !== this.name()) this.renamed.emit(trimmed);
  }

  describe(value: string): void {
    if (value !== this.description()) this.descriptionChange.emit(value);
  }

  onImagePicked(input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = '';
    if (file?.type.startsWith('image/')) this.imagePicked.emit(file);
  }
}
