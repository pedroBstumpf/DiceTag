import { Component, computed, inject, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { WORLD_ITEM_META, WorldItem } from '../../../../core/models/world-item.model';
import { WorldbuildService } from '../../services/worldbuild.service';

/**
 * Pasta aberta como janela na mesa de trabalho do Worldbuild: mostra o conteúdo dela
 * (pastas primeiro). Clicar num item pede para abri-lo na janela dele; numa subpasta,
 * abre outra janela de pasta. Serve para organizar visualmente o mundo na mesa de trabalho.
 */
@Component({
  selector: 'app-folder-view',
  imports: [MatIconModule],
  host: { class: 'block h-full overflow-y-auto p-3' },
  template: `
    @if (folder(); as f) {
      <div class="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-1">
        @for (item of children(); track item.id) {
          <button
            type="button"
            class="flex flex-col items-center gap-1.5 rounded-lg p-2 text-center text-xs text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
            [attr.aria-label]="'Abrir ' + item.name"
            (click)="opened.emit(item.id)"
          >
            <mat-icon class="!size-9 !text-[36px]" [class]="metaOf(item).color">{{ metaOf(item).icon }}</mat-icon>
            <span class="line-clamp-2 w-full break-words leading-tight">{{ item.name }}</span>
          </button>
        } @empty {
          <p class="col-span-full px-3 py-8 text-center text-sm text-slate-500">Pasta vazia. Arraste itens para ela no explorador.</p>
        }
      </div>
    } @else {
      <p class="p-6 text-center text-sm text-slate-500">Esta pasta não existe mais.</p>
    }
  `,
})
export class FolderView {
  private readonly service = inject(WorldbuildService);

  readonly itemId = input.required<string>();
  /** Pedido para abrir um item (ou subpasta) numa janela. */
  readonly opened = output<string>();

  readonly folder = computed(() => {
    const item = this.service.byId().get(this.itemId());
    return item?.type === 'folder' ? item : undefined;
  });
  readonly children = computed(() => (this.folder() ? this.service.childrenOf(this.itemId()) : []));

  metaOf(item: WorldItem) {
    return WORLD_ITEM_META[item.type];
  }
}
