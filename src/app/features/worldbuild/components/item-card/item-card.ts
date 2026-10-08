import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { Tag } from '../../../../core/models/tag.model';
import { WorldbuildService } from '../../services/worldbuild.service';
import { ItemCardView } from './item-card-view';

/**
 * Cartão de um item do mundo (janela do item no Worldbuild ou na mesa):
 * carrega o item do serviço e grava imagem, nome e etiquetas nele.
 * Funciona com o WorldbuildService ou com a Lore geral (diretiva appLoreScope).
 * O visual fica no ItemCardView (também usado pelo inventário da ficha).
 */
@Component({
  selector: 'app-item-card',
  imports: [ItemCardView],
  host: { class: 'block h-full overflow-y-auto p-5' },
  template: `
    @if (item(); as it) {
      <app-item-card-view
        [name]="it.name"
        [tags]="tags()"
        [imageUrl]="src()"
        (renamed)="service.rename(it.id, $event)"
        (tagsChange)="setTags(it.id, $event)"
        (imagePicked)="service.setImage(it.id, $event)"
      />
    } @else {
      <p class="p-6 text-center text-sm text-slate-500">Este item não existe mais.</p>
    }
  `,
})
export class ItemCard {
  readonly service = inject(WorldbuildService);

  readonly itemId = input.required<string>();

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

  setTags(id: string, tags: Tag[]): void {
    this.service.update(id, { tags });
  }
}
