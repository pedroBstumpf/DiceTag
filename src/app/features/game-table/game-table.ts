import { Component, DestroyRef, ElementRef, computed, effect, inject, input, untracked, viewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { TABLE_ENTRY_META, TableEntry } from '../../core/models/table-session.model';
import { WORLD_ITEM_META } from '../../core/models/world-item.model';
import { GameTablesService } from '../../core/services/game-tables.service';
import { FloatingWindow } from '../../shared/components/floating-window/floating-window';
import { WindowManagerService } from '../../shared/services/window-manager.service';
import { DocumentEditor } from '../worldbuild/components/document-editor/document-editor';
import { ImageViewer } from '../worldbuild/components/image-viewer/image-viewer';
import { TimelineEditor } from '../worldbuild/components/timeline-editor/timeline-editor';
import { WorldbuildService } from '../worldbuild/services/worldbuild.service';
import { ActionBar } from './components/action-bar/action-bar';
import { EntryWindow } from './components/entry-window/entry-window';
import { MapStage } from './components/map-stage/map-stage';
import { SceneBar } from './components/scene-bar/scene-bar';
import { SidePanel } from './components/side-panel/side-panel';
import { SoundPlayer } from './components/sound-player/sound-player';
import { TABLE_TOOLS, ToolBar } from './components/tool-bar/tool-bar';
import { TableSessionService } from './services/table-session.service';

/** O que uma janela da mesa está exibindo. */
interface WindowContent {
  title: string;
  icon: string;
  color: string;
  /** Tipo de conteúdo, usado para escolher o componente. */
  type: 'sound' | 'entry' | 'document' | 'timeline' | 'image';
}

/** Tamanho inicial das janelas por tipo de conteúdo. */
const WINDOW_SIZES: Record<WindowContent['type'], { width: number; height: number }> = {
  sound: { width: 380, height: 320 },
  entry: { width: 520, height: 480 },
  document: { width: 720, height: 600 },
  timeline: { width: 620, height: 560 },
  image: { width: 720, height: 520 },
};

/** Espaço ocupado por cada barra (para enquadrar o mapa na área livre). */
const PANEL_SPACE = { top: 60, left: 76, right: 344, bottom: 100 };

/**
 * Tela da mesa de jogo — a mais importante do DiceTag.
 *
 * O mapa ocupa a tela inteira e as barras flutuam sobre ele:
 * - topo: cenas/mapas         - esquerda: ferramentas
 * - direita: fichas, lore, sons, automações
 * - baixo: barra de ações (mestre/jogador)
 * Todas podem ser escondidas (ou tudo de uma vez: modo imersivo, tecla "\").
 * Arquivos abrem em janelas que podem ser movidas, redimensionadas,
 * minimizadas e fixadas em qualquer ponto da tela.
 */
@Component({
  selector: 'app-game-table',
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    FloatingWindow,
    MapStage,
    SceneBar,
    ToolBar,
    SidePanel,
    ActionBar,
    EntryWindow,
    SoundPlayer,
    DocumentEditor,
    TimelineEditor,
    ImageViewer,
  ],
  providers: [TableSessionService, WindowManagerService],
  templateUrl: './game-table.html',
  host: {
    class: 'relative block h-dvh overflow-hidden',
    '(window:keydown)': 'onKeydown($event)',
    '(window:pagehide)': 'session.flush()',
  },
})
export class GameTablePage {
  readonly session = inject(TableSessionService);
  readonly windows = inject(WindowManagerService);
  private readonly tables = inject(GameTablesService);
  private readonly worldbuild = inject(WorldbuildService);
  private readonly snackBar = inject(MatSnackBar);

  /** Id da mesa (parâmetro da rota /mesa/:id). */
  readonly id = input.required<string>();

  readonly table = computed(() => this.tables.getById(this.id()));
  readonly tablesLoaded = this.tables.loaded;

  private readonly map = viewChild(MapStage);
  private readonly windowLayer = viewChild<ElementRef<HTMLElement>>('windowLayer');

  /** Área ocupada pelas barras visíveis (usada para enquadrar o mapa). */
  readonly insets = computed(() => {
    const p = this.session.panels();
    return {
      top: p.scenes ? PANEL_SPACE.top : 0,
      left: p.tools ? PANEL_SPACE.left : 0,
      right: p.side ? PANEL_SPACE.right : 0,
      bottom: p.actions ? PANEL_SPACE.bottom : 0,
    };
  });

  constructor() {
    // Carrega o estado da mesa quando o id muda (untracked: só o id dispara o efeito)
    effect(() => {
      const id = this.id();
      untracked(() => this.session.load(id));
    });
    inject(DestroyRef).onDestroy(() => this.session.flush());
  }

  // --- Janelas -------------------------------------------------------------

  /** Descobre o que mostrar numa janela (arquivo da mesa ou item do worldbuild). */
  content(id: string): WindowContent | null {
    const entry = this.session.entryById().get(id);
    if (entry) {
      const meta = TABLE_ENTRY_META[entry.kind];
      return { title: entry.name, icon: entry.icon ?? meta.icon, color: meta.color, type: entry.kind === 'sound' ? 'sound' : 'entry' };
    }
    const item = this.worldbuild.byId().get(id);
    if (item && item.type !== 'folder') {
      const meta = WORLD_ITEM_META[item.type];
      return { title: item.name, icon: meta.icon, color: meta.color, type: item.type };
    }
    return null;
  }

  open(id: string): void {
    const type = this.content(id)?.type ?? 'entry';
    const el = this.windowLayer()?.nativeElement;
    this.windows.open(id, { width: el?.clientWidth ?? 1200, height: el?.clientHeight ?? 800 }, WINDOW_SIZES[type]);
  }

  // --- Ações ---------------------------------------------------------------

  /** Uma automação foi usada na barra inferior. */
  onActionUsed(entry: TableEntry): void {
    this.snackBar.open(`⚡ ${entry.name}`, undefined, { duration: 1500 });
  }

  /** Atalhos de teclado da mesa (ignorados enquanto se digita). */
  onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, [contenteditable="true"]') || event.ctrlKey || event.metaKey || event.altKey) return;

    const key = event.key.toLowerCase();
    const tool = TABLE_TOOLS.find((t) => t.key.toLowerCase() === key && !t.soon);

    if (tool) this.session.tool.set(tool.id);
    else if (key === '\\') this.session.toggleImmersive();
    else if (key === 'g') this.toggleGrid();
    else if (key === '=' || key === '+') this.map()?.zoomBy(1.2);
    else if (key === '-') this.map()?.zoomBy(1 / 1.2);
    else if (/^[0-9]$/.test(key)) this.useSlot(key === '0' ? 9 : Number(key) - 1);
    else return;

    event.preventDefault();
  }

  private toggleGrid(): void {
    const scene = this.session.activeScene();
    if (scene) this.session.updateScene(scene.id, { showGrid: !scene.showGrid });
  }

  private useSlot(index: number): void {
    const entry = this.session.hotbar()[index];
    if (entry) this.onActionUsed(entry);
  }
}
