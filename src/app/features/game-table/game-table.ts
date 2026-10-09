import { Component, DestroyRef, ElementRef, computed, effect, inject, input, untracked, viewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { NPC_TOKEN_SHEET, ROLL_OUTCOMES, TABLE_ENTRY_META, TableEntry, hasSheet } from '../../core/models/table-session.model';
import { WORLD_ITEM_META } from '../../core/models/world-item.model';
import { GameTablesService } from '../../core/services/game-tables.service';
import { FloatingWindow } from '../../shared/components/floating-window/floating-window';
import { WindowManagerService } from '../../shared/services/window-manager.service';
import { DocumentEditor } from '../worldbuild/components/document-editor/document-editor';
import { Explorer } from '../worldbuild/components/explorer/explorer';
import { ImageViewer } from '../worldbuild/components/image-viewer/image-viewer';
import { ItemCard } from '../worldbuild/components/item-card/item-card';
import { TimelineEditor } from '../worldbuild/components/timeline-editor/timeline-editor';
import { LoreScope } from '../worldbuild/directives/lore-scope.directive';
import { WorldNpcSheet } from '../worldbuild/directives/world-npc-sheet.directive';
import { LoreService } from '../worldbuild/services/lore.service';
import { WorldbuildService } from '../worldbuild/services/worldbuild.service';
import { ActionBar } from './components/action-bar/action-bar';
import { CharacterSheetView } from './components/character-sheet/character-sheet';
import { EntryWindow } from './components/entry-window/entry-window';
import { EquippedItemWindow, parseEquippedWindow } from './components/equipped-item-window/equipped-item-window';
import { itemSources } from './components/sheet-inventory/sheet-inventory';
import { inventoryRow } from './utils/inventory';
import { TableItemWindow } from './components/table-item-window/table-item-window';
import { MapStage } from './components/map-stage/map-stage';
import { SceneBar } from './components/scene-bar/scene-bar';
import { LORE_WINDOW, SidePanel, WORLDBUILD_WINDOW } from './components/side-panel/side-panel';
import { TABLE_TOOLS, ToolBar, toolAllowed } from './components/tool-bar/tool-bar';
import { TokenWindow } from './components/token-window/token-window';
import { BlobUrlService } from './services/blob-url.service';
import { SheetStore } from '../../core/services/sheet-store';
import { SoundMixerService } from './services/sound-mixer.service';
import { TableSessionService, tokenSheetPlacement } from './services/table-session.service';
import { formatModifier, levelUpText } from './utils/dice';

/** O que uma janela da mesa está exibindo. */
interface WindowContent {
  title: string;
  icon: string;
  color: string;
  /** Tipo de conteúdo, usado para escolher o componente. */
  type: 'entry' | 'sheet' | 'token' | 'equipped' | 'table-item' | 'explorer' | 'document' | 'timeline' | 'image' | 'item' | 'npc';
  /** O conteúdo vem da Lore geral (os editores usam o LoreService). */
  global?: boolean;
}

/** Prefixo do id das janelas "Token" (token:<id do token colocado>). */
const TOKEN_WINDOW = 'token:';

/** Tamanho inicial das janelas por tipo de conteúdo. */
const WINDOW_SIZES: Record<WindowContent['type'], { width: number; height: number }> = {
  entry: { width: 520, height: 480 },
  sheet: { width: 880, height: 700 },
  token: { width: 460, height: 560 },
  equipped: { width: 420, height: 600 },
  'table-item': { width: 420, height: 600 },
  explorer: { width: 340, height: 540 },
  document: { width: 720, height: 600 },
  timeline: { width: 620, height: 560 },
  image: { width: 720, height: 520 },
  item: { width: 420, height: 600 },
  npc: { width: 880, height: 700 },
};

/** Espaço ocupado por cada barra (para enquadrar o mapa na área livre). */
const PANEL_SPACE = { top: 60, left: 76, right: 344, bottom: 100 };

/**
 * Tela da mesa de jogo — a mais importante do app.
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
    CharacterSheetView,
    TokenWindow,
    EquippedItemWindow,
    TableItemWindow,
    LoreScope,
    WorldNpcSheet,
    Explorer,
    DocumentEditor,
    TimelineEditor,
    ImageViewer,
    ItemCard,
  ],
  providers: [
    TableSessionService,
    // As fichas da mesa leem e gravam pela sessão
    { provide: SheetStore, useExisting: TableSessionService },
    SoundMixerService,
    BlobUrlService,
    WindowManagerService,
  ],
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
  /** Mestre: único que acessa o Worldbuild na mesa e edita a lore (o jogador só lê o que foi revelado). */
  readonly isGm = computed(() => this.session.role() === 'gm');
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

    // Fecha janelas "Token" e fichas de token de tokens removidos do mapa
    effect(() => {
      const stale = this.windows.windows().filter((w) => {
        const placementId = w.id.startsWith(TOKEN_WINDOW) ? w.id.slice(TOKEN_WINDOW.length) : tokenSheetPlacement(w.id);
        return placementId !== null && !this.session.resolvedTokenById(placementId);
      });
      if (stale.length) untracked(() => this.windows.closeMany(stale.map((w) => w.id)));
    });
  }

  // --- Janelas -------------------------------------------------------------

  /** Descobre o que mostrar numa janela (arquivo/token da mesa ou item do worldbuild / Lore geral). */
  content(id: string): WindowContent | null {
    // Os exploradores do Worldbuild e da Lore geral são só do mestre
    if (id === WORLDBUILD_WINDOW) {
      return this.isGm() ? { title: 'Worldbuild', icon: 'public', color: 'text-sky-300', type: 'explorer' } : null;
    }
    if (id === LORE_WINDOW) {
      return this.isGm() ? { title: 'Lore geral', icon: 'auto_stories', color: 'text-star-400', type: 'explorer', global: true } : null;
    }
    if (id.startsWith(TOKEN_WINDOW)) {
      const token = this.session.resolvedTokenById(id.slice(TOKEN_WINDOW.length));
      return token ? { title: `Token: ${token.name}`, icon: 'token', color: TABLE_ENTRY_META[token.entry.kind].color, type: 'token' } : null;
    }
    // Item do inventário de uma ficha (lista "Equipados" da aba Ficha)
    const equipped = parseEquippedWindow(id);
    if (equipped) {
      const item = this.session.inventoryOf(equipped.sheetId).find((i) => i.id === equipped.inventoryId);
      if (!item || !this.session.canOpenSheet(equipped.sheetId)) return null;
      const name = inventoryRow(item, itemSources(this.loreGeneral, this.worldbuild, this.session)).name;
      return { title: name, icon: 'inventory_2', color: 'text-amber-300', type: 'equipped' };
    }
    // Ficha própria de um token de NPC (cópia individual)
    const placementId = tokenSheetPlacement(id);
    if (placementId) {
      const token = this.session.resolvedTokenById(placementId);
      if (!token || !this.session.canOpenSheet(id)) return null;
      return { title: `${token.name} (token)`, icon: 'smart_toy', color: TABLE_ENTRY_META.npc.color, type: 'sheet' };
    }
    const entry = this.session.entryById().get(id);
    // Sons não abrem janela: são controlados direto no mixer da aba Sons.
    // NPC do painel só abre para quem o edita (os jogadores veem NPCs pelos tokens).
    if (entry && entry.kind !== 'sound' && (!hasSheet(entry.kind) || this.session.canOpenSheet(entry.id))) {
      const meta = TABLE_ENTRY_META[entry.kind];
      // Personagem e NPC abrem a ficha completa (abas); automação, a janela de configuração
      const type = hasSheet(entry.kind) ? 'sheet' : 'entry';
      return { title: entry.name, icon: entry.icon ?? meta.icon, color: meta.color, type };
    }
    // Item criado na mesa por um jogador (aba Lore; visível aos jogadores)
    const tableItem = this.session.tableItemById().get(id);
    if (tableItem) {
      if (!this.session.canSeeLoreItem(id)) return null;
      return { title: this.session.loreName(tableItem), icon: 'inventory_2', color: 'text-amber-300', type: 'table-item' };
    }
    // Itens da lore: o título usa o nome desta mesa (pode ter sido renomeado só aqui).
    // O jogador só abre itens de pastas da aba Lore que o mestre revelou.
    const globalItem = this.loreGeneral.byId().get(id);
    const item = globalItem ?? this.worldbuild.byId().get(id);
    if (item && item.type !== 'folder' && this.session.canSeeLoreItem(item.id)) {
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

  /**
   * Duplo clique num token: personagem abre a janela "Token"; NPC abre a ficha própria
   * daquele token (status, inventário e temas individuais) — para o jogador, só se ele
   * controla o NPC ou o mestre deixou a ficha/inventário públicos.
   */
  openToken(placementId: string): void {
    const entry = this.session.resolvedTokenById(placementId)?.entry;
    if (entry?.kind === 'npc') {
      if (this.session.canOpenSheet(NPC_TOKEN_SHEET + placementId)) this.open(NPC_TOKEN_SHEET + placementId);
      return;
    }
    this.open(TOKEN_WINDOW + placementId);
  }

  /** Ficha e item da janela de item equipado (o tipo 'equipped' garante que o id é válido). */
  equippedOf(windowId: string): { sheetId: string; inventoryId: string } {
    return parseEquippedWindow(windowId) ?? { sheetId: '', inventoryId: '' };
  }

  /** Id do token colocado a partir do id da janela "Token". */
  placementOf(windowId: string): string {
    return windowId.slice(TOKEN_WINDOW.length);
  }

  // --- Ações ---------------------------------------------------------------

  /**
   * Uma ação foi usada na barra inferior: rola, registra no chat e, se tiver efeito,
   * o deixa no mouse. O aviso resume o resultado (o detalhe fica no chat).
   */
  onActionUsed(entry: TableEntry, sheetId?: string): void {
    const { author, roll, armed, levelUps } = this.session.useAction(entry, sheetId);
    const formula = roll.dice + formatModifier(roll.modifier);
    const text = `${author} · ${roll.action}: ${formula} = ${roll.total} — ${ROLL_OUTCOMES[roll.outcome].label}`;
    this.snackBar.open(armed ? `${text} · arraste no mapa para lançar o efeito` : text, undefined, { duration: 3500 });
    // Estudo que alcançou o SN: notificação em destaque (também vai para o chat)
    if (levelUps.length) this.snackBar.open(levelUpText(levelUps), 'OK', { duration: 8000 });
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
    // Ctrl+C / Ctrl+V: copia o token selecionado / cola uma cópia sob o mouse (inclusive em outra cena)
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && this.copyPasteToken(event.key.toLowerCase())) {
      event.preventDefault();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    // Teclas que dependem da seleção/ferramenta do mapa (Delete, Esc…)
    if (this.map()?.handleKey(event)) {
      event.preventDefault();
      return;
    }

    const key = event.key.toLowerCase();
    // Ferramentas do mestre (Névoa, paredes) não têm atalho no papel de jogador
    const tool = TABLE_TOOLS.find((t) => t.key.toLowerCase() === key && toolAllowed(t, this.session.role()));

    if (tool) this.session.tool.set(tool.id);
    else if (key === 'w' && this.isGm()) this.startWalls();
    else if (key === '\\') this.session.toggleImmersive();
    else if (key === '=' || key === '+') this.map()?.zoomBy(1.2);
    else if (key === '-') this.map()?.zoomBy(1 / 1.2);
    else if (/^[0-9]$/.test(key)) this.useSlot(key === '0' ? 9 : Number(key) - 1);
    else return;

    event.preventDefault();
  }

  /**
   * Ctrl+C copia o token selecionado; Ctrl+V cola. Texto selecionado na página tem prioridade
   * (o Ctrl+C copia o texto, como sempre). Retorna true se tratou a tecla.
   */
  private copyPasteToken(key: string): boolean {
    if (key === 'c') {
      const selected = this.session.selectedTokenId();
      if (!selected || window.getSelection()?.toString() || !this.session.copyToken(selected)) return false;
      this.snackBar.open('Token copiado: Ctrl+V cola uma cópia sob o mouse.', undefined, { duration: 2000 });
      return true;
    }
    return key === 'v' && !!this.map()?.pasteToken();
  }

  /** Atalho W: ferramenta Névoa já no modo "Parede — linha". */
  private startWalls(): void {
    this.session.tool.set('fog');
    this.session.wallMode.set('line');
  }

  private useSlot(index: number): void {
    const entry = this.session.hotbar()[index];
    if (entry) this.onActionUsed(entry);
  }
}
