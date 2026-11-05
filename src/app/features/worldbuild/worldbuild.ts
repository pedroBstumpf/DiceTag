import { DestroyRef, Component, ElementRef, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { WORLD_ITEM_META, WorldItemType } from '../../core/models/world-item.model';
import { LayoutService } from '../../core/services/layout.service';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { FloatingWindow } from '../../shared/components/floating-window/floating-window';
import { WindowManagerService } from '../../shared/services/window-manager.service';
import { DocumentEditor } from './components/document-editor/document-editor';
import { Explorer } from './components/explorer/explorer';
import { ImageViewer } from './components/image-viewer/image-viewer';
import { CharacterSheetView } from '../game-table/components/character-sheet/character-sheet';
import { BlobUrlService } from '../game-table/services/blob-url.service';
import { ItemCard } from './components/item-card/item-card';
import { RaceCard } from './components/race-card/race-card';
import { FolderView } from './components/folder-view/folder-view';
import { WorldNpcSheet } from './directives/world-npc-sheet.directive';
import { TimelineEditor } from './components/timeline-editor/timeline-editor';
import { WorldbuildService } from './services/worldbuild.service';

/** Tipos que podem ser criados pela URL (imagens só por envio de arquivo). */
const URL_CREATABLE_TYPES: readonly WorldItemType[] = ['document', 'timeline', 'folder', 'item', 'npc', 'race'];

/**
 * Página de Worldbuild do mundo aberto.
 * À esquerda, o explorador (pastas e itens, com o seletor de mundo; pode ser escondido).
 * À direita, a mesa de trabalho, onde cada item (e cada pasta) abre numa janela
 * flutuante que pode ser movida, redimensionada e maximizada. As janelas ficam salvas
 * por mundo (WorldbuildService.desk) e voltam iguais depois de recarregar a página.
 *
 * Parâmetros de URL (vindos da barra lateral):
 *   ?novo=document|timeline|folder|item|npc|race → cria um item novo
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
    RaceCard,
    FolderView,
    CharacterSheetView,
    WorldNpcSheet,
  ],
  // BlobUrlService: imagens da ficha dos NPCs do bestiário
  providers: [WindowManagerService, BlobUrlService],
  templateUrl: './worldbuild.html',
  host: { class: 'block h-full' },
})
export class Worldbuild {
  readonly service = inject(WorldbuildService);
  readonly windows = inject(WindowManagerService);
  private readonly layout = inject(LayoutService);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);

  readonly meta = WORLD_ITEM_META;

  // --- Parâmetros de URL ---------------------------------------------------
  readonly novo = input<WorldItemType>();
  readonly abrir = input<string>();
  /** Id de um mundo do servidor: o mestre o prepara aqui, sem abrir a mesa (vem de "Mesas online"). */
  readonly servidor = input<string>();

  // --- Estado da página ----------------------------------------------------
  /** Explorador visível (no mobile começa escondido). */
  readonly explorerOpen = signal(!this.layout.isMobile());
  private readonly workspace = viewChild<ElementRef<HTMLElement>>('workspace');

  constructor() {
    // Mundo do servidor pedido na URL (o servidor só entrega o mundo ao dono)
    effect(() => {
      const worldId = this.servidor();
      untracked(() => (worldId ? this.service.openOnline({ worldId, canEdit: true }) : this.service.closeOnline()));
    });
    inject(DestroyRef).onDestroy(() => this.service.closeOnline());
    effect(() => {
      const notice = this.service.notice();
      if (notice) untracked(() => this.snackBar.open(notice.text, undefined, { duration: 4000 }));
    });

    // Mesa de trabalho: quando o mundo termina de carregar, volta às janelas salvas dele
    // (antes das ações da URL, que podem abrir mais uma janela por cima)
    effect(() => {
      if (!this.service.loaded()) return;
      const saved = this.service.desk();
      untracked(() => this.windows.restore(saved.filter((w) => this.service.byId().has(w.id))));
    });
    // Toda mudança nas janelas (abrir, mover, redimensionar, minimizar, fixar) é guardada no mundo
    effect(() => {
      const list = this.windows.windows();
      untracked(() => this.service.saveDesk(list));
    });

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
        this.router.navigate([], { queryParams: { novo: null, abrir: null }, queryParamsHandling: 'merge', replaceUrl: true });
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
