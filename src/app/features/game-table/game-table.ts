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
import { Explorer } from '../worldbuild/components/explorer/explorer';
import { ImageViewer } from '../worldbuild/components/image-viewer/image-viewer';
import { TimelineEditor } from '../worldbuild/components/timeline-editor/timeline-editor';
import { LoreScope } from '../worldbuild/directives/lore-scope.directive';
import { LoreService } from '../worldbuild/services/lore.service';
import { WorldbuildService } from '../worldbuild/services/worldbuild.service';
import { ActionBar } from './components/action-bar/action-bar';
import { EntryWindow } from './components/entry-window/entry-window';
import { MapStage } from './components/map-stage/map-stage';
import { SceneBar } from './components/scene-bar/scene-bar';
import { LORE_WINDOW, SidePanel, WORLDBUILD_WINDOW } from './components/side-panel/side-panel';
import { TABLE_TOOLS, ToolBar } from './components/tool-bar/tool-bar';
import { TokenWindow } from './components/token-window/token-window';
import { BlobUrlService } from './services/blob-url.service';
import { SoundMixerService } from './services/sound-mixer.service';
import { TableSessionService } from './services/table-session.service';

/** O que uma janela da mesa está exibindo. */
interface WindowContent {
  title: string;
  icon: string;
  color: string;
  /** Tipo de conteúdo, usado para escolher o componente. */
  type: 'entry' | 'token' | 'explorer' | 'document' | 'timeline' | 'image';
  /** O conteúdo vem da Lore geral (os editores usam o LoreService). */
  global?: boolean;
}

/** Prefixo do id das janelas "Token" (token:<id do token colocado>). */
const TOKEN_WINDOW = 'token:';

/** Tamanho inicial das janelas por tipo de conteúdo. */
const WINDOW_SIZES: Record<WindowContent['type'], { width: number; height: number }> = {
  entry: { width: 520, height: 480 },
  token: { width: 460, height: 560 },
  explorer: { width: 340, height: 540 },
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
    TokenWindow,
    LoreScope,
    Explorer,
    DocumentEditor,
    TimelineEditor,
    ImageViewer,
  ],
  providers: [TableSessionService, SoundMixerService, BlobUrlService, WindowManagerService],
  templateUrl: './game-table.html',
  host: {
    class: 'relative block h-dvh overflow-hidden',
    '(window:keydown)': 'onKeydown($event)',
    // Soltar WASD/setas encerra o movimento do token; perder o foco também
    '(window:keyup)': 'map()?.handleKeyUp($event)',
    '(window:blur)': 'map()?.stopKeyMove()',
    '(window:pagehide)': 'session.flush()',
  },
})
export class GameTablePage {
  readonly session = inject(TableSessionService);
  readonly windows = inject(WindowManagerService);
  private readonly tables = inject(GameTablesService);
  private readonly worldbuild = inject(WorldbuildService);
  private readonly loreGeneral = inject(LoreService);
  private readonly snackBar = inject(MatSnackBar);

  /** Id da mesa (parâmetro da rota /mesa/:id). */
  readonly id = input.required<string>();

  readonly table = computed(() => this.tables.getById(this.id()));
  readonly tablesLoaded = this.tables.loaded;

  protected readonly map = viewChild(MapStage);
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

    // Fecha janelas "Token" de tokens removidos do mapa
    effect(() => {
      const stale = this.windows
        .windows()
        .filter((w) => w.id.startsWith(TOKEN_WINDOW) && !this.session.resolvedTokenById(w.id.slice(TOKEN_WINDOW.length)));
      if (stale.length) untracked(() => this.windows.closeMany(stale.map((w) => w.id)));
    });
  }

  // --- Janelas -------------------------------------------------------------

  /** Descobre o que mostrar numa janela (arquivo/token da mesa ou item do worldbuild / Lore geral). */
  content(id: string): WindowContent | null {
    if (id === WORLDBUILD_WINDOW) {
      return { title: 'Worldbuild', icon: 'public', color: 'text-sky-300', type: 'explorer' };
    }
    if (id === LORE_WINDOW) {
      return { title: 'Lore geral', icon: 'auto_stories', color: 'text-star-400', type: 'explorer', global: true };
    }
    if (id.startsWith(TOKEN_WINDOW)) {
      const token = this.session.resolvedTokenById(id.slice(TOKEN_WINDOW.length));
      return token ? { title: `Token: ${token.entry.name}`, icon: 'token', color: TABLE_ENTRY_META[token.entry.kind].color, type: 'token' } : null;
    }
    const entry = this.session.entryById().get(id);
    // Sons não abrem janela: são controlados direto no mixer da aba Sons
    if (entry && entry.kind !== 'sound') {
      const meta = TABLE_ENTRY_META[entry.kind];
      return { title: entry.name, icon: entry.icon ?? meta.icon, color: meta.color, type: 'entry' };
    }
    // Itens da lore: o título usa o nome desta mesa (pode ter sido renomeado só aqui)
    const globalItem = this.loreGeneral.byId().get(id);
    const item = globalItem ?? this.worldbuild.byId().get(id);
    if (item && item.type !== 'folder') {
      const meta = WORLD_ITEM_META[item.type];
      return { title: this.session.loreName(item), icon: meta.icon, color: meta.color, type: item.type, global: !!globalItem };
    }
    return null;
  }

  open(id: string): void {
    const type = this.content(id)?.type ?? 'entry';
    const el = this.windowLayer()?.nativeElement;
    this.windows.open(id, { width: el?.clientWidth ?? 1200, height: el?.clientHeight ?? 800 }, WINDOW_SIZES[type]);
  }

  /** Abre a janela "Token" de um token colocado no mapa. */
  openToken(placementId: string): void {
    this.open(TOKEN_WINDOW + placementId);
  }

  /** Id do token colocado a partir do id da janela "Token". */
  placementOf(windowId: string): string {
    return windowId.slice(TOKEN_WINDOW.length);
  }

  // --- Ações ---------------------------------------------------------------

  /** Uma automação foi usada na barra inferior. */
  onActionUsed(entry: TableEntry): void {
    this.snackBar.open(`⚡ ${entry.name}`, undefined, { duration: 1500 });
  }

  /** Atalhos de teclado da mesa (ignorados enquanto se digita). */
  onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, [contenteditable="true"]')) return;

    // Ctrl+Z: desfaz o último traço da cena (fora de campos de texto)
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
      if (this.session.undoDrawing()) event.preventDefault();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    // Teclas que dependem da seleção/ferramenta do mapa (Delete, Esc…)
    if (this.map()?.handleKey(event)) {
      event.preventDefault();
      return;
    }

    const key = event.key.toLowerCase();
    const tool = TABLE_TOOLS.find((t) => t.key.toLowerCase() === key && !t.soon);

    if (tool) this.session.tool.set(tool.id);
    else if (key === 'w') this.startWalls();
    else if (key === '\\') this.session.toggleImmersive();
    else if (key === 'g') this.toggleGrid();
    else if (key === '=' || key === '+') this.map()?.zoomBy(1.2);
    else if (key === '-') this.map()?.zoomBy(1 / 1.2);
    else if (/^[0-9]$/.test(key)) this.useSlot(key === '0' ? 9 : Number(key) - 1);
    else return;

    event.preventDefault();
  }

  /** Atalho W: ferramenta Névoa já no modo "Parede — linha". */
  private startWalls(): void {
    this.session.tool.set('fog');
    this.session.wallMode.set('line');
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
