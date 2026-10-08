import { Component, ElementRef, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { WORLD_ITEM_META, WorldItemType } from '../../core/models/world-item.model';
import { AuthService } from '../../core/services/auth.service';
import { LayoutService } from '../../core/services/layout.service';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { FloatingWindow } from '../../shared/components/floating-window/floating-window';
import { QuickActionsService } from '../../shared/services/quick-actions.service';
import { WindowManagerService } from '../../shared/services/window-manager.service';
import { DocumentEditor } from './components/document-editor/document-editor';
import { Explorer } from './components/explorer/explorer';
import { ImageViewer } from './components/image-viewer/image-viewer';
import { ItemCard } from './components/item-card/item-card';
import { TimelineEditor } from './components/timeline-editor/timeline-editor';
import { WorldbuildService } from './services/worldbuild.service';

/** Tipos que podem ser criados pela URL (imagens só por envio de arquivo). */
const URL_CREATABLE_TYPES: readonly WorldItemType[] = ['document', 'timeline', 'folder', 'item'];

/**
 * Página de Worldbuild.
 * À esquerda, o explorador (pastas e itens, pode ser escondido).
 * À direita, a área de trabalho, onde cada item abre numa janela
 * flutuante que pode ser movida, redimensionada e maximizada.
 *
 * Parâmetros de URL (vindos da barra lateral):
 *   ?novo=document|timeline|folder|item → cria um item novo
 *   ?abrir=<id>                    → abre um item existente
 */
@Component({
  selector: 'app-worldbuild',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    EmptyState,
    Explorer,
    FloatingWindow,
    DocumentEditor,
    TimelineEditor,
    ImageViewer,
    ItemCard,
  ],
  providers: [WindowManagerService],
  templateUrl: './worldbuild.html',
  host: { class: 'block h-full' },
})
export class Worldbuild {
  readonly auth = inject(AuthService);
  readonly service = inject(WorldbuildService);
  readonly windows = inject(WindowManagerService);
  readonly actions = inject(QuickActionsService);
  private readonly layout = inject(LayoutService);
  private readonly router = inject(Router);

  readonly meta = WORLD_ITEM_META;

  // --- Parâmetros de URL ---------------------------------------------------
  readonly novo = input<WorldItemType>();
  readonly abrir = input<string>();

  // --- Estado da página ----------------------------------------------------
  /** Explorador visível (no mobile começa escondido). */
  readonly explorerOpen = signal(!this.layout.isMobile());
  private readonly workspace = viewChild<ElementRef<HTMLElement>>('workspace');

  constructor() {
    // Executa as ações pedidas pela URL assim que os dados estiverem carregados
    effect(() => {
      const type = this.novo();
      const openId = this.abrir();
      if (!this.service.loaded() || (!type && !openId)) return;

      untracked(() => {
        // Valores desconhecidos são ignorados (evita salvar itens inválidos)
        if (type && URL_CREATABLE_TYPES.includes(type)) {
          const item = this.service.create(type);
          if (type === 'folder') this.explorerOpen.set(true);
          else this.open(item.id);
        }
        if (openId && this.service.byId().has(openId)) this.open(openId);

        // Limpa a URL para não repetir a ação ao recarregar
        this.router.navigate([], { queryParams: {}, replaceUrl: true });
      });
    });
  }

  // --- Ações ---------------------------------------------------------------

  /** Abre um item numa janela (no mobile, esconde o explorador). */
  open(itemId: string): void {
    const el = this.workspace()?.nativeElement;
    this.windows.open(itemId, { width: el?.clientWidth ?? 900, height: el?.clientHeight ?? 700 });
    if (this.layout.isMobile()) this.explorerOpen.set(false);
  }

  /** Cria um item a partir do estado vazio da área de trabalho. */
  createAndOpen(type: WorldItemType): void {
    const item = this.service.create(type);
    this.open(item.id);
  }
}
