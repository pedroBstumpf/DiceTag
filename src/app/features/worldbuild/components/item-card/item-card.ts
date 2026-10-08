import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Tag } from '../../../../core/models/tag.model';
import { TagEditor } from '../../../../shared/components/tag-editor/tag-editor';
import { WorldbuildService } from '../../services/worldbuild.service';

/**
 * Cartão de um item do mundo: imagem, nome e etiquetas.
 *
 * - Editável (janela do item no Worldbuild ou na mesa): enviar/trocar imagem,
 *   renomear e editar as etiquetas (cor e nível).
 * - Só leitura (`readonly`): usado ao lado da lista do inventário da ficha.
 * Funciona com o WorldbuildService ou com a Lore geral (diretiva appLoreScope).
 */
@Component({
  selector: 'app-item-card',
  imports: [MatIconModule, MatTooltipModule, TagEditor],
  host: { class: 'block h-full overflow-y-auto' },
  template: `
    @if (item(); as it) {
      <article
        class="mx-auto flex max-w-sm flex-col overflow-hidden rounded-xl bg-gradient-to-b from-ink-800 to-ink-900 shadow-lg shadow-black/40 ring-1 ring-astral-400/25"
        [class.my-5]="!readonly()"
      >
        <!-- Imagem do item -->
        <div class="relative aspect-[4/3] w-full bg-ink-950">
          @if (src(); as url) {
            <img [src]="url" alt="" class="size-full object-cover" />
          } @else {
            <div class="grid size-full place-items-center text-slate-600">
              <mat-icon class="!size-12 !text-[48px]">inventory_2</mat-icon>
            </div>
          }
          @if (!readonly()) {
            <button
              type="button"
              class="absolute inset-0 grid place-items-center bg-black/60 text-white opacity-0 transition-opacity hover:opacity-100 focus:opacity-100"
              [attr.aria-label]="it.blobId ? 'Trocar imagem' : 'Enviar imagem'"
              (click)="imageInput.click()"
            >
              <span class="flex flex-col items-center gap-1 text-xs">
                <mat-icon>add_photo_alternate</mat-icon>
                {{ it.blobId ? 'Trocar imagem' : 'Enviar imagem' }}
              </span>
            </button>
            <input #imageInput type="file" accept="image/*" hidden (change)="onImagePicked(imageInput)" />
          }
        </div>

        <div class="flex flex-col gap-3 border-t border-astral-400/20 p-4">
          <!-- Nome -->
          @if (readonly()) {
            <h3 class="font-display text-xl text-star-300">{{ it.name }}</h3>
          } @else {
            <input
              #nameInput
              class="w-full bg-transparent font-display text-xl text-star-300 outline-none placeholder:text-slate-600"
              placeholder="Nome do item"
              aria-label="Nome do item"
              [value]="it.name"
              (blur)="service.rename(it.id, nameInput.value)"
              (keydown.enter)="nameInput.blur()"
            />
          }

          <!-- Etiquetas -->
          @if (readonly()) {
            <div class="flex flex-wrap gap-1.5">
              @for (tag of tags(); track tag.id) {
                <span class="rounded-md px-2 py-0.5 text-xs font-semibold text-ink-950" [style.background]="tag.color">
                  {{ tag.text }}{{ tag.level ? ' ' + tag.level : '' }}
                </span>
              } @empty {
                <span class="text-xs text-slate-600">Sem etiquetas.</span>
              }
            </div>
          } @else {
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
                placeholder="Ex.: Mágico"
                emptyText="Ex.: Arma, Mágico, Consumível."
                (changed)="setTags(it.id, $event)"
              />
            </div>
          }
        </div>
      </article>
    } @else {
      <p class="p-6 text-center text-sm text-slate-500">Este item não existe mais.</p>
    }
  `,
})
export class ItemCard {
  readonly service = inject(WorldbuildService);

  readonly itemId = input.required<string>();
  /** Só exibe o cartão (sem edição). */
  readonly readonly = input(false);

  readonly item = computed(() => this.service.byId().get(this.itemId()));
  readonly tags = computed<Tag[]>(() => this.item()?.tags ?? []);
  /** Só muda quando a imagem muda (evita recarregar a cada edição do nome/etiquetas). */
  private readonly blobId = computed(() => this.item()?.blobId);
  readonly src = signal<string | null>(null);

  constructor() {
    // Carrega a imagem do IndexedDB (cancelado se a imagem mudar antes de terminar)
    effect(async (onCleanup) => {
      const blobId = this.blobId();
      this.src.set(null);
      if (!blobId) return;
      let url: string | undefined;
      let cancelled = false;
      onCleanup(() => {
        cancelled = true;
        if (url) URL.revokeObjectURL(url);
      });
      const blob = await this.service.getBlob(blobId);
      if (cancelled || !blob) return;
      url = URL.createObjectURL(blob);
      this.src.set(url);
    });
  }

  async onImagePicked(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (file?.type.startsWith('image/')) await this.service.setImage(this.itemId(), file);
  }

  setTags(id: string, tags: Tag[]): void {
    this.service.update(id, { tags });
  }
}
