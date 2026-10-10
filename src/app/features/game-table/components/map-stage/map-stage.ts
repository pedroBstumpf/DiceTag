import { Component, DestroyRef, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Point, Rect } from '../../../../core/models/geometry.model';
import { DROP_SIZE, ITEM_DRAG_TYPE, ItemDragData, METERS_PER_SQUARE, Wall } from '../../../../core/models/table-session.model';
import { newId } from '../../../../core/utils/id';
import { Viewport, fitRect, zoomAt } from '../../../../shared/utils/viewport';
import { BlobUrlService } from '../../services/blob-url.service';
import { ResolvedToken, TableSessionService } from '../../services/table-session.service';
import { distanceToPolyline, sizeFromHandle, snapToCorner, snapTokenCenter } from '../../utils/geometry';
import { isRadialFx } from '../../utils/effects';
import { IDENTITY, Mat2, apply, invert, isoMatrix, matrixCss, project, projectedBounds, unproject, uprightMatrix, viewCss } from '../../utils/projection';
import { pointInRect, rectFromCorners, shiftGroup } from '../../utils/selection';
import { simplifyPath } from '../../utils/simplify';
import { distanceToWall, handleAt, moveWallHandle, translateWall } from '../../utils/walls';
import { DoorsLayer } from '../map-layers/doors-layer/doors-layer';
import { DropPointerDown, DropsLayer } from '../map-layers/drops-layer/drops-layer';
import { DrawingsLayer, StrokeDraft } from '../map-layers/drawings-layer/drawings-layer';
import { FogLayer } from '../map-layers/fog-layer/fog-layer';
import { FxDraft, FxLayer } from '../map-layers/fx-layer/fx-layer';
import { NotePointerDown, NotesLayer } from '../map-layers/notes-layer/notes-layer';
import { NotePopover } from '../note-popover/note-popover';
import { TOKEN_DRAG_TYPE, TokenPointerDown, TokensLayer } from '../map-layers/tokens-layer/tokens-layer';
import { WallDraft, WallsLayer } from '../map-layers/walls-layer/walls-layer';

const MIN_SCALE = 0.1;
const MAX_SCALE = 6;
/** Tamanho do "papel quadriculado" quando a cena ainda não tem mapa. */
const EMPTY_WORLD = { w: 2100, h: 1400 };
/** Intervalo máximo entre dois cliques para contar como duplo clique (ms). */
const DOUBLE_TAP_MS = 350;

/** Distância (px na tela) para clicar numa parede ou no ponto inicial da linha. */
const HIT_TOLERANCE = 10;

/** Gesto de ponteiro em andamento no mapa. */
type Gesture =
  | { kind: 'pan'; sx: number; sy: number; ox: number; oy: number }
  | { kind: 'ruler' }
  /**
   * Arrastar token: `group` = os outros tokens selecionados (posição inicial), que acompanham.
   * `onClick` = o que um clique sem arrastar faz ao soltar: selecionar só este token (clique num
   * token de um grupo) ou tirá-lo da seleção (Shift+clique num já selecionado).
   */
  | {
      kind: 'token';
      id: string;
      size: number;
      sx: number;
      sy: number;
      cx: number;
      cy: number;
      group: { id: string; x: number; y: number }[];
      moved: boolean;
      onClick: 'none' | 'only' | 'deselect';
    }
  /** Caixa de seleção (Selecionar, arrastar no fundo): canto inicial em px da área; Shift soma à seleção. */
  | { kind: 'marquee'; sx: number; sy: number; additive: boolean }
  | { kind: 'resize'; id: string; cx: number; cy: number }
  | { kind: 'circle'; cx: number; cy: number }
  | { kind: 'door'; a: Point }
  /** Editar parede: `handle` = índice da alça arrastada, ou -1 para mover a parede inteira. */
  | { kind: 'wall'; sx: number; sy: number; original: Wall; handle: number }
  | { kind: 'draw' }
  | { kind: 'erase' }
  | { kind: 'fx' }
  | { kind: 'note'; id: string; sx: number; sy: number; nx: number; ny: number; moved: boolean }
  /** Item no chão: o mestre arrasta para mover (`size` = lado em quadrados, para o alinhamento). */
  | { kind: 'drop'; id: string; size: number; sx: number; sy: number; nx: number; ny: number; moved: boolean }
  /** Alça do item no chão selecionado (mestre): muda o tamanho. */
  | { kind: 'dropResize'; id: string; cx: number; cy: number };

/** Largura do popover de anotação (para mantê-lo dentro da tela). */
const POPOVER_WIDTH = 288;

/** Teclas de movimento do token selecionado → direção. */
const MOVE_KEYS: Record<string, Point> = {
  w: { x: 0, y: -1 },
  arrowup: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  arrowdown: { x: 0, y: 1 },
  a: { x: -1, y: 0 },
  arrowleft: { x: -1, y: 0 },
  d: { x: 1, y: 0 },
  arrowright: { x: 1, y: 0 },
};
/** Shift multiplica a velocidade do token movido pelo teclado (a base vem da ficha). */
const KEY_SPEED_FAST = 2.5;
/** Clique sem arrastar com Explosão/Onda: raio em quadrados. */
const FX_CLICK_RADIUS = 1.5;

/** Matriz da vista isométrica (referência fixa: comparada por identidade). */
const ISO = isoMatrix();
/** Distância vertical entre camadas do mapa na vista isométrica, em quadrados da grade. */
const LEVEL_GAP_SQUARES = 3;
/** Duração da animação de troca de camada / de vista (ms). */
const VIEW_ANIMATION_MS = 550;

/** Camada do mapa como o MapStage a desenha. */
interface Plane {
  id: string;
  index: number;
  blobId?: string;
  /** Distância até a camada em foco: > 0 abaixo, < 0 acima, 0 = em foco. */
  depth: number;
  focused: boolean;
  /** Tokens desta camada (só exibição; os da camada em foco são interativos). */
  tokens: ResolvedToken[];
  /** Sombras de tokens voando nas camadas de cima, projetadas nesta. */
  shadows: ResolvedToken[];
}

/**
 * Mapa central da mesa — orquestrador das camadas.
 *
 * Cuida de zoom (roda do mouse, no cursor), pan, conversão tela↔mundo e do
 * roteamento do ponteiro conforme a ferramenta ativa. Cada camada
 * (map-layers/) só desenha e avisa interações; as mutações passam pelo
 * TableSessionService.
 *
 * Ordem das camadas no "mundo", de baixo para cima:
 *   mapa → grade → desenhos → notas → itens no chão → névoa → tokens visíveis → portas → paredes → efeitos, régua e ping
 * Acima do mundo fica a interface (popover de anotação, avisos).
 */
@Component({
  selector: 'app-map-stage',
  imports: [MatIconModule, MatTooltipModule, DrawingsLayer, NotesLayer, DropsLayer, FogLayer, TokensLayer, DoorsLayer, WallsLayer, FxLayer, NotePopover],
  templateUrl: './map-stage.html',
  host: { class: 'block' },
})
export class MapStage {
  readonly session = inject(TableSessionService);
  readonly blobs = inject(BlobUrlService);

  /** Espaço reservado pelas barras (para centralizar o mapa na área livre). */
  readonly insets = input({ top: 0, right: 0, bottom: 0, left: 0 });
  /** Duplo clique num token: abrir a janela "Token". */
  readonly tokenOpened = output<string>();
  /** Clique num item no chão: abrir o cartão dele (id do item largado). */
  readonly dropOpened = output<string>();
  /** Aviso ao largar um item (sucesso ou motivo de não ter largado). */
  readonly dropNotice = output<string>();

  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');

  // --- Vista ---------------------------------------------------------------
  readonly view = signal<Viewport>({ x: 0, y: 0, scale: 1 });
  readonly scale = computed(() => this.view().scale);
  readonly src = signal<string | null>(null);
  readonly world = signal(EMPTY_WORLD);

  // --- Projeção (2D ou isométrica) e camadas -------------------------------
  /** Matriz da vista: isométrica ou 2D (identidade). */
  readonly matrix = computed<Mat2>(() => (this.session.isometric() ? ISO : IDENTITY));
  /** Deixa um elemento do mundo "em pé" (tokens, marcadores, botões): matriz e CSS. */
  readonly uprightMat = computed(() => uprightMatrix(this.matrix()));
  readonly upright = computed(() => matrixCss(this.uprightMat()));
  /** Transições ligadas só durante a troca de camada/vista (pan e zoom ficam instantâneos). */
  readonly animating = signal(false);
  private animationTimer?: ReturnType<typeof setTimeout>;
  /** Cena + mapa já enquadrados (recarregar a imagem não reenquadra). */
  private fittedKey = '';

  /** Camadas do mapa, de baixo para cima, com a distância até a camada em foco. */
  readonly planes = computed<Plane[]>(() => {
    const current = this.session.currentLevel();
    const byLevel = this.session.tokensByLevel();
    const levels = this.session.mapLevels();
    const list = levels.length ? levels : [{ id: 'ground', index: 0, name: '', blobId: undefined }];
    // Tokens voando projetam sombra no "chão" mais próximo abaixo (camada com imagem ou térreo)
    const shadows = new Map<number, ResolvedToken[]>();
    if (this.session.isometric()) {
      for (const [level, tokens] of byLevel) {
        if (level === 0) continue;
        let ground = 0;
        for (let j = level - 1; j > 0; j--) {
          if (list[j]?.blobId) {
            ground = j;
            break;
          }
        }
        shadows.set(ground, [...(shadows.get(ground) ?? []), ...tokens]);
      }
    }
    return list.map((l) => ({
      id: l.id,
      index: l.index,
      blobId: l.blobId,
      depth: current - l.index,
      focused: l.index === current,
      // Camadas acima com mapa mostram só o contorno; as sem mapa ("ar") mostram quem voa nelas
      tokens: l.index < current || (l.index > current && !l.blobId) ? (byLevel.get(l.index) ?? []) : [],
      shadows: shadows.get(l.index) ?? [],
    }));
  });

  /** Transformação de uma camada: a vista + o deslocamento vertical da pilha (só na isométrica). */
  planeTransform(depth: number): string {
    const lift = this.session.isometric() ? depth * LEVEL_GAP_SQUARES * this.gridSize() * this.scale() : 0;
    return viewCss(this.view(), this.matrix(), lift);
  }

  /**
   * Camadas acima da em foco: as sem mapa ("ar") aparecem inteiras (só têm tokens voando);
   * as com mapa mostram só o contorno da logo acima, na isométrica, e somem na 2D.
   */
  planeOpacity(plane: Plane): number {
    if (plane.depth >= 0 || !plane.blobId) return 1;
    return this.session.isometric() && plane.depth === -1 ? 0.35 : 0;
  }

  /** Camadas abaixo da em foco ficam mais escuras conforme a profundidade. */
  planeFilter(depth: number): string | null {
    if (depth <= 0) return null;
    return `brightness(${Math.max(0.3, 0.7 - 0.15 * (depth - 1))}) saturate(0.75)`;
  }

  // --- Interações ----------------------------------------------------------
  readonly panning = signal(false);
  readonly ruler = signal<{ from: Point; to: Point } | null>(null);
  /** Caixa de seleção em andamento, em px da área do mapa (fora do mundo: sempre reta). */
  readonly marquee = signal<Rect | null>(null);
  readonly pings = signal<(Point & { id: string })[]>([]);
  /** Parede sendo desenhada (ferramenta Névoa). */
  readonly wallDraft = signal<WallDraft | null>(null);
  /** Traço em andamento (ferramenta Desenhar). */
  readonly strokeDraft = signal<StrokeDraft | null>(null);
  /** Traços tocados pela borracha no gesto atual (removidos de uma vez ao soltar). */
  readonly erasing = signal<ReadonlySet<string>>(new Set());
  /** Efeito sendo mirado (ferramenta Efeitos): de onde até onde. */
  readonly fxDraft = signal<FxDraft | null>(null);
  /** Forma e cor que o próximo lançamento vai usar (a da ação armada ou a da ferramenta). */
  readonly fxCurrent = computed(() => this.session.armedFx() ?? this.session.fxStyle());

  readonly scene = this.session.activeScene;
  readonly gridSize = computed(() => this.scene()?.gridSize ?? 70);
  /** Com a grade escondida, tokens e paredes se movem livres (sem alinhar à grade). */
  readonly snapping = computed(() => this.scene()?.showGrid ?? true);
  /** Muda só quando troca a cena ou o mapa (não ao ajustar a grade). */
  private readonly mapKey = computed(() => ({ sceneId: this.scene()?.id, blobId: this.scene()?.blobId }), {
    equal: (a, b) => a.sceneId === b.sceneId && a.blobId === b.blobId,
  });

  /** Modo "Editar paredes" ativo (mostra alças e permite mover). */
  readonly editingWalls = computed(() => this.session.tool() === 'fog' && this.session.wallMode() === 'edit');

  /** Tokens recebem o ponteiro só na ferramenta Selecionar. */
  readonly selecting = computed(() => this.session.tool() === 'select');
  /** Marcadores de anotação recebem o ponteiro em Selecionar e Anotação. */
  readonly notesInteractive = computed(() => this.session.tool() === 'select' || this.session.tool() === 'note');

  // --- Anotação aberta (popover) -------------------------------------------
  readonly openNoteId = signal<string | null>(null);
  /** Anotação aberta, se ainda estiver visível (some ao trocar para Jogador, por exemplo). */
  readonly openNote = computed(() => this.session.visibleNotes().find((n) => n.id === this.openNoteId()) ?? null);
  /** Posição do popover na tela: logo abaixo da ponta do marcador, dentro da área. */
  readonly popoverPos = computed(() => {
    const note = this.openNote();
    if (!note) return null;
    const p = project(this.view(), this.matrix(), note);
    const width = this.stage().nativeElement.clientWidth;
    return { left: Math.max(8, Math.min(p.x - POPOVER_WIDTH / 2, width - POPOVER_WIDTH - 8)), top: p.y + 10 };
  });

  /** Distância da régua em quadrados e metros. */
  readonly rulerLabel = computed(() => {
    const r = this.ruler();
    if (!r) return '';
    const squares = Math.hypot(r.to.x - r.from.x, r.to.y - r.from.y) / this.gridSize();
    return `${squares.toFixed(1)} quad. · ${(squares * METERS_PER_SQUARE).toFixed(1)} m`;
  });
  /** Posição do rótulo da régua na tela (fora do mundo, para ficar sempre reto). */
  readonly rulerLabelPos = computed(() => {
    const r = this.ruler();
    return r ? project(this.view(), this.matrix(), r.to) : null;
  });

  /** Cursor conforme a ferramenta ativa. */
  readonly cursor = computed(() => {
    if (this.panning()) return 'grabbing';
    const tool = this.session.tool();
    if (tool === 'fog') {
      const mode = this.session.wallMode();
      return mode === 'erase' ? 'pointer' : mode === 'edit' ? 'move' : 'crosshair';
    }
    if (tool === 'draw') return this.session.brush().eraser ? 'cell' : 'crosshair';
    if (tool === 'select') return 'default';
    return tool === 'ruler' || tool === 'ping' || tool === 'note' || tool === 'fx' ? 'crosshair' : 'grab';
  });

  private gesture: Gesture | null = null;
  private lastTap = { key: '', time: 0, x: 0, y: 0 };
  /** Posição do mouse sobre o mapa, em px da área (null = fora do mapa). Usada para colar tokens. */
  pointerAt: Point | null = null;
  /** Teclas de movimento pressionadas (WASD/setas) e o laço de animação delas. */
  private readonly heldKeys = new Set<string>();
  private keyFrame = 0;
  private keyFast = false;
  /** Muda só ao trocar de cena (editar a cena não altera). */
  private readonly sceneId = computed(() => this.scene()?.id);

  constructor() {
    // Carrega a imagem da cena ativa (ou usa o papel quadriculado)
    effect(async (onCleanup) => {
      const { sceneId, blobId } = this.mapKey();
      if (!blobId) {
        this.src.set(null);
        this.setWorld(sceneId, EMPTY_WORLD);
        queueMicrotask(() => this.fit());
        return;
      }
      // Cancela este carregamento se a cena mudar antes de o arquivo chegar
      let url: string | undefined;
      let cancelled = false;
      onCleanup(() => {
        cancelled = true;
        if (url) URL.revokeObjectURL(url);
      });
      const blob = await this.session.getBlob(blobId);
      if (cancelled || !blob) return;
      url = URL.createObjectURL(blob);
      this.src.set(url);
    });

    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(this.keyFrame));

    // Trocar de ferramenta, de modo ou de cena descarta a parede (e a mira de efeito) em construção
    effect(() => {
      this.session.tool();
      this.session.wallMode();
      this.sceneId();
      this.wallDraft.set(null);
      this.fxDraft.set(null);
    });

    // Na mesma cena: trocar de camada anima a pilha; trocar 2D ↔ isométrica anima e reenquadra
    let prev = { scene: undefined as string | undefined, level: 0, iso: false };
    effect(() => {
      const next = { scene: this.sceneId(), level: this.session.currentLevel(), iso: this.session.isometric() };
      untracked(() => {
        if (next.scene === prev.scene && (next.level !== prev.level || next.iso !== prev.iso)) this.animate();
        if (next.scene === prev.scene && next.iso !== prev.iso) this.fit();
        prev = next;
      });
    });
  }

  // --- Zoom e enquadramento ------------------------------------------------

  /** Mapa carregado: ajusta o tamanho do mundo e enquadra (só na primeira vez de cada cena/mapa). */
  onImageLoad(img: HTMLImageElement): void {
    const { sceneId, blobId } = this.mapKey();
    this.setWorld(sceneId, { w: img.naturalWidth, h: img.naturalHeight });
    const key = `${sceneId}:${blobId}`;
    if (key !== this.fittedKey) {
      this.fittedKey = key;
      this.fit();
    }
  }

  /** Liga as transições por um instante (troca de camada ou de vista). */
  private animate(): void {
    this.animating.set(true);
    clearTimeout(this.animationTimer);
    this.animationTimer = setTimeout(() => this.animating.set(false), VIEW_ANIMATION_MS);
  }

  /** Tamanho do mundo (mapa) — também informado à sessão, junto com a cena a que pertence. */
  private setWorld(sceneId: string | undefined, size: { w: number; h: number }): void {
    this.world.set(size);
    this.session.worldSize.set(sceneId ? { sceneId, ...size } : null);
  }

  /** Enquadra o mapa inteiro (já projetado: na isométrica, o losango) na área livre entre as barras. */
  fit(): void {
    const el = this.stage().nativeElement;
    const i = this.insets();
    const { w, h } = this.world();
    this.view.set(
      fitRect(projectedBounds(this.matrix(), w, h), {
        x: i.left,
        y: i.top,
        width: el.clientWidth - i.left - i.right,
        height: el.clientHeight - i.top - i.bottom,
      }),
    );
  }

  zoomBy(factor: number, cx?: number, cy?: number): void {
    const el = this.stage().nativeElement;
    this.view.update((v) => zoomAt(v, factor, cx ?? el.clientWidth / 2, cy ?? el.clientHeight / 2, MIN_SCALE, MAX_SCALE));
  }

  onWheel(event: WheelEvent): void {
    event.preventDefault();
    const rect = this.stage().nativeElement.getBoundingClientRect();
    this.zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX - rect.left, event.clientY - rect.top);
  }

  // --- Ponteiro: fundo do mapa ---------------------------------------------

  onPointerDown(event: PointerEvent): void {
    const tool = this.session.tool();
    // Clicar fora fecha a anotação aberta
    this.openNoteId.set(null);

    // Botão do meio sempre move o mapa; a ferramenta Mover arrasta o fundo
    if (event.button === 1 || (event.button === 0 && tool === 'pan')) {
      event.preventDefault();
      this.startPan(event);
      return;
    }
    if (event.button !== 0) return;

    const p = this.toWorld(event);
    if (tool === 'select') {
      // Selecionar: arrastar no fundo desenha a caixa de seleção (clique simples limpa a seleção)
      const at = this.toScreen(event);
      this.gesture = { kind: 'marquee', sx: at.x, sy: at.y, additive: event.shiftKey };
      this.capture(event);
    } else if (tool === 'ruler') {
      this.ruler.set({ from: p, to: p });
      this.gesture = { kind: 'ruler' };
      this.capture(event);
    } else if (tool === 'ping') {
      this.addPing(p);
    } else if (tool === 'fog') {
      this.onFogDown(event, p);
    } else if (tool === 'draw') {
      this.onDrawDown(event, p);
    } else if (tool === 'fx') {
      // Efeito: arrasta da origem até o alvo/alcance
      this.fxDraft.set({ from: p, to: p });
      this.gesture = { kind: 'fx' };
      this.capture(event);
    } else if (tool === 'note') {
      // Clicar no mapa cria uma anotação e já abre a edição
      const note = this.session.addNote(p);
      if (note) this.openNoteId.set(note.id);
    }
  }

  // --- Ponteiro: anotações -------------------------------------------------

  /** Marcador pressionado: arrastar move; clique simples abre a edição. */
  onNoteDown({ event, note }: NotePointerDown): void {
    this.openNoteId.set(null);
    this.gesture = { kind: 'note', id: note.id, sx: event.clientX, sy: event.clientY, nx: note.x, ny: note.y, moved: false };
    this.capture(event);
  }

  closeNote(): void {
    this.openNoteId.set(null);
  }

  // --- Ponteiro: itens no chão ---------------------------------------------

  /**
   * Item pressionado: clique seleciona (Delete o tira do mapa), duplo clique abre o cartão.
   * O mestre arrasta para mover e usa a alça para mudar o tamanho.
   */
  onDropDown({ event, drop, mode }: DropPointerDown): void {
    this.openNoteId.set(null);
    this.session.selectDrop(drop.id);
    if (mode === 'resize') {
      this.gesture = { kind: 'dropResize', id: drop.id, cx: drop.x, cy: drop.y };
    } else {
      if (this.isDoubleTap(`drop:${drop.id}`, event)) {
        this.dropOpened.emit(drop.id);
        return;
      }
      const size = drop.size ?? DROP_SIZE;
      this.gesture = { kind: 'drop', id: drop.id, size, sx: event.clientX, sy: event.clientY, nx: drop.x, ny: drop.y, moved: false };
    }
    this.capture(event);
  }

  // --- Ferramenta Desenhar -------------------------------------------------

  private onDrawDown(event: PointerEvent, p: Point): void {
    const { eraser, color, width, opacity } = this.session.brush();
    if (eraser) {
      this.erasing.set(new Set());
      this.eraseAt(p);
      this.gesture = { kind: 'erase' };
    } else {
      this.strokeDraft.set({ points: [p], color, width, opacity });
      this.gesture = { kind: 'draw' };
    }
    this.capture(event);
  }

  /** Marca os traços tocados pela borracha neste ponto. */
  private eraseAt(p: Point): void {
    const tolerance = HIT_TOLERANCE / this.scale();
    const touched = this.session
      .drawings()
      .filter((s) => !this.erasing().has(s.id) && distanceToPolyline(p, s.points) <= s.width / 2 + tolerance);
    if (touched.length) this.erasing.update((set) => new Set([...set, ...touched.map((s) => s.id)]));
  }

  /** Salva o traço em andamento, com os pontos simplificados. */
  private finishStroke(): void {
    const draft = this.strokeDraft();
    this.strokeDraft.set(null);
    if (!draft) return;
    // Tolerância de ~1px na tela: invisível ao olho, mas reduz bastante os pontos
    const points = simplifyPath(draft.points, 1 / this.scale());
    this.session.addStroke({ ...draft, points });
  }

  // --- Ferramenta Efeitos --------------------------------------------------

  /**
   * Lança o efeito mirado. Arraste curto: efeitos radiais usam um raio padrão;
   * as formas com direção são ignoradas (o efeito armado de uma ação continua na mão).
   */
  private finishFx(): void {
    const draft = this.fxDraft();
    this.fxDraft.set(null);
    if (!draft) return;
    const { from, to } = draft;
    if (Math.hypot(to.x - from.x, to.y - from.y) * this.scale() > 8) {
      this.session.castFx(from, to, this.scale());
    } else if (isRadialFx(this.fxCurrent().kind)) {
      this.session.castFx(from, { x: from.x + FX_CLICK_RADIUS * this.gridSize(), y: from.y }, this.scale());
    }
  }

  // --- Ferramenta Névoa: paredes -------------------------------------------

  private onFogDown(event: PointerEvent, p: Point): void {
    const mode = this.session.wallMode();
    if (mode === 'erase') {
      const wall = this.wallAt(p);
      if (wall) this.session.removeWall(wall.id);
    } else if (mode === 'circle') {
      this.wallDraft.set({ kind: 'circle', cx: p.x, cy: p.y, r: 0 });
      this.gesture = { kind: 'circle', cx: p.x, cy: p.y };
      this.capture(event);
    } else if (mode === 'door') {
      // Porta: arrasta de um batente ao outro
      const a = this.snapCorner(p, event);
      this.wallDraft.set({ kind: 'door', a, b: a });
      this.gesture = { kind: 'door', a };
      this.capture(event);
    } else if (mode === 'edit') {
      this.onWallEditDown(event, p);
    } else {
      this.addLinePoint(event, p);
    }
  }

  /** Editar paredes: alça da parede selecionada, corpo de uma parede ou fundo (move o mapa). */
  private onWallEditDown(event: PointerEvent, p: Point): void {
    const selected = this.session.walls().find((w) => w.id === this.session.selectedWallId());
    const handle = selected ? handleAt(selected, p, HIT_TOLERANCE / this.scale()) : -1;
    const wall = handle >= 0 ? selected : this.wallAt(p);
    if (!wall) {
      this.session.selectedWallId.set(null);
      this.startPan(event);
      return;
    }
    this.session.selectedWallId.set(wall.id);
    this.gesture = { kind: 'wall', sx: event.clientX, sy: event.clientY, original: wall, handle };
    this.capture(event);
  }

  /** Parede em linha, clique a clique: duplo clique ou clicar no ponto inicial finaliza. */
  private addLinePoint(event: PointerEvent, raw: Point): void {
    const p = this.snapCorner(raw, event);
    const draft = this.wallDraft();
    const points = draft?.kind === 'line' ? draft.points : [];

    if (points.length && this.isDoubleTap('parede', event)) {
      this.finishLine();
      return;
    }
    // Clicar no ponto inicial fecha a parede (ex.: sala)
    const first = points[0];
    if (points.length >= 2 && Math.hypot(raw.x - first.x, raw.y - first.y) < HIT_TOLERANCE / this.scale()) {
      this.finishLine([...points, first]);
      return;
    }
    const last = points[points.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) this.wallDraft.set({ kind: 'line', points: [...points, p], cursor: p });
  }

  /** Salva a parede em linha em construção (precisa de pelo menos 2 pontos). */
  private finishLine(points?: Point[]): void {
    const draft = this.wallDraft();
    const final = points ?? (draft?.kind === 'line' ? draft.points : []);
    if (final.length >= 2) this.session.addWall({ kind: 'line', points: final });
    this.wallDraft.set(null);
  }

  /**
   * Parede resultante do arraste: alça → move só aquele ponto (alinhado aos cantos);
   * corpo → move tudo (em passos de quadrado, para paredes alinhadas continuarem alinhadas).
   */
  private editedWall(g: Extract<Gesture, { kind: 'wall' }>, event: PointerEvent): Wall {
    if (g.handle >= 0) {
      const p = this.toWorld(event);
      return moveWallHandle(g.original, g.handle, g.original.kind === 'circle' ? p : this.snapCorner(p, event));
    }
    const grid = this.gridSize();
    let { x: dx, y: dy } = this.screenDelta(event.clientX - g.sx, event.clientY - g.sy);
    if (this.snapOn(event)) {
      dx = Math.round(dx / grid) * grid;
      dy = Math.round(dy / grid) * grid;
    }
    return translateWall(g.original, dx, dy);
  }

  /** Parede sob o ponto (a mais recente primeiro), com tolerância constante na tela. */
  private wallAt(p: Point) {
    const tolerance = HIT_TOLERANCE / this.scale();
    return [...this.session.walls()].reverse().find((w) => distanceToWall(w, p) < tolerance);
  }

  // --- Ponteiro: tokens ----------------------------------------------------

  /** Mestre move tudo; jogador, os personagens e os NPCs que controla (regra: session.canEdit). */
  readonly canMoveToken = (token: ResolvedToken): boolean => this.session.canEdit(token.entry);

  /**
   * Token pressionado: seleciona, move (com snap) ou redimensiona. Duplo clique abre a janela.
   * - Shift+clique põe o token na seleção (ou, se já estava, tira ao soltar sem arrastar).
   * - Arrastar um token selecionado move o grupo todo junto, na mesma formação.
   * Quem não pode mexer no token (jogador x NPC que não controla) só seleciona e abre.
   */
  onTokenDown({ event, token, mode }: TokenPointerDown): void {
    const id = token.placement.id;
    this.openNoteId.set(null);
    const editable = this.session.canEdit(token.entry);
    const selected = this.session.selectedTokenIds();
    let onClick: 'none' | 'only' | 'deselect' = 'none';
    if (event.shiftKey && mode !== 'resize' && editable) {
      if (selected.has(id)) onClick = 'deselect';
      else this.session.toggleTokenSelection(id);
    } else if (selected.has(id) && selected.size > 1 && editable) {
      // Mantém o grupo para poder arrastá-lo; um clique simples seleciona só este token
      onClick = 'only';
    } else {
      this.session.selectToken(id);
    }
    const { x: cx, y: cy } = token.placement;

    if (!editable) {
      if (this.isDoubleTap(id, event)) this.tokenOpened.emit(id);
      return;
    }
    if (mode === 'resize') {
      this.gesture = { kind: 'resize', id, cx, cy };
    } else {
      if (this.isDoubleTap(id, event)) {
        this.session.selectToken(id);
        this.tokenOpened.emit(id);
        return;
      }
      // Os outros selecionados (que a conta pode mover) acompanham o arraste
      const group = this.session
        .movableSelection()
        .filter((t) => t.placement.id !== id)
        .map((t) => ({ id: t.placement.id, x: t.placement.x, y: t.placement.y }));
      this.gesture = { kind: 'token', id, size: token.size, sx: event.clientX, sy: event.clientY, cx, cy, group, moved: false, onClick };
    }
    this.capture(event);
  }

  // --- Ponteiro: movimento e fim -------------------------------------------

  onPointerMove(event: PointerEvent): void {
    this.pointerAt = this.toScreen(event);
    // Prévia do próximo trecho da parede em linha
    const draft = this.wallDraft();
    if (draft?.kind === 'line') {
      const raw = this.toWorld(event);
      this.wallDraft.set({ ...draft, cursor: this.snapCorner(raw, event) });
    }

    const g = this.gesture;
    if (!g) return;

    if (g.kind === 'pan') {
      this.view.update((v) => ({ ...v, x: g.ox + event.clientX - g.sx, y: g.oy + event.clientY - g.sy }));
    } else if (g.kind === 'ruler') {
      this.ruler.update((r) => (r ? { ...r, to: this.toWorld(event) } : r));
    } else if (g.kind === 'token') {
      // Alguns px de folga: abaixo disso é um clique (não move)
      if (!g.moved && Math.hypot(event.clientX - g.sx, event.clientY - g.sy) < 3) return;
      g.moved = true;
      const d = this.screenDelta(event.clientX - g.sx, event.clientY - g.sy);
      let p = { x: g.cx + d.x, y: g.cy + d.y };
      // Snap ao centro do quadrado (Shift ou grade escondida: livre); o grupo segue o mesmo deslocamento
      if (this.snapOn(event)) p = snapTokenCenter(p, g.size, this.gridSize());
      const current = this.session.tokens().find((t) => t.id === g.id);
      if (current && (current.x !== p.x || current.y !== p.y)) {
        const delta = { x: p.x - g.cx, y: p.y - g.cy };
        this.session.moveTokens([{ placementId: g.id, ...p }, ...shiftGroup(g.group, delta)]);
      }
    } else if (g.kind === 'marquee') {
      this.marquee.set(rectFromCorners({ x: g.sx, y: g.sy }, this.toScreen(event)));
    } else if (g.kind === 'resize') {
      const size = sizeFromHandle({ x: g.cx, y: g.cy }, this.toWorld(event), this.gridSize());
      if (this.session.resolvedTokenById(g.id)?.size !== size) this.session.updateToken(g.id, { size });
    } else if (g.kind === 'circle') {
      const p = this.toWorld(event);
      this.wallDraft.set({ kind: 'circle', cx: g.cx, cy: g.cy, r: Math.hypot(p.x - g.cx, p.y - g.cy) });
    } else if (g.kind === 'door') {
      this.wallDraft.set({ kind: 'door', a: g.a, b: this.snapCorner(this.toWorld(event), event) });
    } else if (g.kind === 'wall') {
      this.session.updateWall(this.editedWall(g, event));
    } else if (g.kind === 'draw') {
      const p = this.toWorld(event);
      this.strokeDraft.update((d) => {
        if (!d) return d;
        const last = d.points[d.points.length - 1];
        // Ignora movimentos menores que ~1,5px na tela
        return Math.hypot(p.x - last.x, p.y - last.y) * this.scale() < 1.5 ? d : { ...d, points: [...d.points, p] };
      });
    } else if (g.kind === 'erase') {
      this.eraseAt(this.toWorld(event));
    } else if (g.kind === 'fx') {
      const to = this.toWorld(event);
      this.fxDraft.update((d) => (d ? { ...d, to } : d));
    } else if (g.kind === 'note') {
      const dx = event.clientX - g.sx;
      const dy = event.clientY - g.sy;
      if (!g.moved && Math.hypot(dx, dy) > 3) g.moved = true;
      if (g.moved) {
        const d = this.screenDelta(dx, dy);
        this.session.moveNote(g.id, { x: g.nx + d.x, y: g.ny + d.y });
      }
    } else if (g.kind === 'drop' && this.session.canManageDrops()) {
      if (!g.moved && Math.hypot(event.clientX - g.sx, event.clientY - g.sy) < 3) return;
      g.moved = true;
      const d = this.screenDelta(event.clientX - g.sx, event.clientY - g.sy);
      const p = { x: g.nx + d.x, y: g.ny + d.y };
      // Alinha ao centro do quadrado como os tokens (Shift ou grade escondida: livre)
      this.session.moveDrop(g.id, this.snapOn(event) ? snapTokenCenter(p, g.size, this.gridSize()) : p);
    } else if (g.kind === 'dropResize') {
      const size = sizeFromHandle({ x: g.cx, y: g.cy }, this.toWorld(event), this.gridSize());
      if (this.session.dropById(g.id)?.drop.size !== size) this.session.updateDrop(g.id, { size });
    }
  }

  onPointerUp(): void {
    const g = this.gesture;
    this.gesture = null;
    this.panning.set(false);
    this.ruler.set(null);

    if (g?.kind === 'note' && !g.moved) this.openNoteId.set(g.id);
    if (g?.kind === 'token' && !g.moved) {
      if (g.onClick === 'only') this.session.selectToken(g.id);
      if (g.onClick === 'deselect') this.session.toggleTokenSelection(g.id);
    }
    if (g?.kind === 'marquee') this.finishMarquee(g.additive);
    if (g?.kind === 'draw') this.finishStroke();
    if (g?.kind === 'fx') this.finishFx();
    if (g?.kind === 'erase') {
      this.session.eraseStrokes([...this.erasing()]);
      this.erasing.set(new Set());
    }

    // Círculo: salva ao soltar (ignora cliques sem arrastar)
    const draft = this.wallDraft();
    if (g?.kind === 'circle' && draft?.kind === 'circle') {
      if (draft.r * this.scale() > 4) this.session.addWall({ kind: 'circle', cx: draft.cx, cy: draft.cy, r: draft.r });
      this.wallDraft.set(null);
    }
    // Porta: salva ao soltar (começa fechada)
    if (g?.kind === 'door' && draft?.kind === 'door') {
      if (Math.hypot(draft.b.x - draft.a.x, draft.b.y - draft.a.y) * this.scale() > 6) {
        this.session.addWall({ kind: 'door', points: [draft.a, draft.b], open: false });
      }
      this.wallDraft.set(null);
    }
  }

  /**
   * Fim da caixa de seleção: seleciona os tokens da camada em foco que a conta pode mover e cujo
   * centro, na tela, está dentro da caixa (vale também na vista isométrica). Clique sem arrastar
   * limpa a seleção (com Shift, mantém).
   */
  private finishMarquee(additive: boolean): void {
    const rect = this.marquee();
    this.marquee.set(null);
    if (!rect || (rect.width < 4 && rect.height < 4)) {
      if (!additive) this.session.selectToken(null);
      return;
    }
    const ids = this.session
      .visibleTokens()
      .filter((t) => this.session.canEdit(t.entry) && pointInRect(project(this.view(), this.matrix(), t.placement), rect))
      .map((t) => t.placement.id);
    this.session.selectTokens(ids, additive);
  }

  // --- Teclado (encaminhado pela página da mesa) ---------------------------

  /** Trata Enter/Esc/Delete conforme a ferramenta e a seleção. Retorna true se a tecla foi usada. */
  handleKey(event: KeyboardEvent): boolean {
    if (event.key === 'Escape' && this.openNoteId()) {
      this.openNoteId.set(null);
      return true;
    }

    // Camadas (mestre, vista isométrica): PageUp/PageDown sobem/descem o token selecionado
    // (a vista o acompanha) ou, sem seleção, a camada em foco
    if ((event.key === 'PageUp' || event.key === 'PageDown') && this.session.role() === 'gm' && this.session.isometric()) {
      const delta = event.key === 'PageUp' ? 1 : -1;
      const selected = this.session.selectedTokenId();
      if (selected) this.session.moveTokenLevel(selected, delta);
      else this.session.viewLevel(this.session.currentLevel() + delta);
      return true;
    }

    // Efeito de uma ação na mão: Esc desiste e volta à ferramenta anterior
    if (event.key === 'Escape' && this.session.armedFx()) {
      this.fxDraft.set(null);
      this.session.cancelArmedFx();
      return true;
    }

    // Parede em linha: Enter finaliza, Esc cancela
    if (this.wallDraft()?.kind === 'line') {
      if (event.key === 'Enter') {
        this.finishLine();
        return true;
      }
      if (event.key === 'Escape') {
        this.wallDraft.set(null);
        return true;
      }
    }

    // Editar paredes: Delete remove a parede selecionada, Esc desmarca
    // (só se a parede for da camada em foco: a seleção pode ter ficado em outra camada)
    const selectedWall = this.editingWalls() ? this.session.selectedWallId() : null;
    const wallId = this.session.walls().some((w) => w.id === selectedWall) ? selectedWall : null;
    if (wallId && (event.key === 'Delete' || event.key === 'Backspace')) {
      this.session.removeWall(wallId);
      return true;
    }
    if (wallId && event.key === 'Escape') {
      this.session.selectedWallId.set(null);
      return true;
    }

    // Item no chão selecionado: Delete o tira do mapa (mestre), Esc desmarca
    const dropId = this.session.selectedDropId();
    if (dropId && this.session.visibleDrops().some((d) => d.id === dropId)) {
      if ((event.key === 'Delete' || event.key === 'Backspace') && this.session.canManageDrops()) {
        this.session.removeDrop(dropId);
        return true;
      }
      if (event.key === 'Escape') {
        this.session.selectDrop(null);
        return true;
      }
    }

    // Tokens selecionados que a conta pode mexer (jogador: não move nem remove NPC que não controla)
    const selected = this.session.selectedTokenId();
    const group = this.session.movableSelection();

    // WASD/setas: desliza o grupo selecionado enquanto a tecla estiver pressionada
    const key = event.key.toLowerCase();
    if (group.length && this.selecting() && MOVE_KEYS[key]) {
      this.keyFast = event.shiftKey;
      if (!this.heldKeys.has(key)) {
        this.heldKeys.add(key);
        if (!this.keyFrame) this.keyFrame = requestAnimationFrame((t) => this.glide(t, t));
      }
      return true;
    }

    if ((event.key === 'Delete' || event.key === 'Backspace') && group.length) {
      for (const t of group) this.session.removeToken(t.placement.id);
      return true;
    }
    if (event.key === 'Escape' && selected) {
      this.session.selectToken(null);
      return true;
    }
    return false;
  }

  /** Soltar uma tecla de movimento; ao soltar todas, o grupo se alinha à grade (se visível). */
  handleKeyUp(event: KeyboardEvent): void {
    this.keyFast = event.shiftKey;
    if (this.heldKeys.delete(event.key.toLowerCase()) && !this.heldKeys.size) this.stopKeyMove();
  }

  /** Encerra o movimento por teclado (também ao perder o foco da janela). */
  stopKeyMove(): void {
    const wasMoving = this.keyFrame !== 0 || this.heldKeys.size > 0;
    this.heldKeys.clear();
    cancelAnimationFrame(this.keyFrame);
    this.keyFrame = 0;
    if (!wasMoving) return;

    // Alinha o token principal à grade; os outros seguem o mesmo ajuste (mantém a formação)
    const group = this.session.movableSelection();
    const lead = group[0];
    if (!lead || !this.snapping()) return;
    const p = snapTokenCenter(lead.placement, lead.size, this.gridSize());
    this.session.moveTokens(shiftGroup(this.origins(group), { x: p.x - lead.placement.x, y: p.y - lead.placement.y }));
  }

  /** Posição atual de cada token do grupo (para deslocar todos juntos). */
  private origins(tokens: ResolvedToken[]): { id: string; x: number; y: number }[] {
    return tokens.map((t) => ({ id: t.placement.id, x: t.placement.x, y: t.placement.y }));
  }

  /** Um quadro do movimento por teclado: velocidade constante, independente da taxa de quadros. */
  private glide(now: number, last: number): void {
    // O grupo anda junto, na velocidade do token principal (mantém a formação)
    const group = this.session.movableSelection();
    const token = group[0];
    if (!token || !this.heldKeys.size) {
      this.keyFrame = 0;
      return;
    }
    let sx = 0;
    let sy = 0;
    for (const key of this.heldKeys) {
      sx += MOVE_KEYS[key].x;
      sy += MOVE_KEYS[key].y;
    }
    // Direção na tela → direção no mapa (na isométrica, "W" sobe na tela, não na diagonal)
    const { x: dx, y: dy } = apply(invert(this.matrix()), { x: sx, y: sy });
    const len = Math.hypot(dx, dy);
    if (len) {
      // Diagonal com a mesma velocidade; no máximo 50ms por quadro (aba em segundo plano)
      const dt = Math.min(now - last, 50) / 1000;
      const step = (token.speed * (this.keyFast ? KEY_SPEED_FAST : 1) * this.gridSize() * dt) / len;
      this.session.moveTokens(shiftGroup(this.origins(group), { x: dx * step, y: dy * step }));
    }
    this.keyFrame = requestAnimationFrame((t) => this.glide(t, now));
  }

  // --- Arrastar fichas e itens do painel/inventário para o mapa ------------

  onDragOver(event: DragEvent): void {
    const types = event.dataTransfer?.types ?? [];
    if (!types.includes(TOKEN_DRAG_TYPE) && !types.includes(ITEM_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer!.dropEffect = types.includes(ITEM_DRAG_TYPE) ? 'move' : 'copy';
  }

  onDrop(event: DragEvent): void {
    const entryId = event.dataTransfer?.getData(TOKEN_DRAG_TYPE);
    const item = event.dataTransfer?.getData(ITEM_DRAG_TYPE);
    if (!entryId && !item) return;
    event.preventDefault();
    if (entryId) this.placeToken(entryId, this.toWorld(event));
    else if (item) void this.dropItem(JSON.parse(item) as ItemDragData, this.toWorld(event));
  }

  /** Larga um item no mapa (alinhado ao centro do quadrado, se a grade estiver visível). */
  private async dropItem(data: ItemDragData, p: Point): Promise<void> {
    if (!this.scene()) {
      this.dropNotice.emit('Crie uma cena antes de largar itens no mapa.');
      return;
    }
    const center = this.snapping() ? snapTokenCenter(p, DROP_SIZE, this.gridSize()) : p;
    const drop = await this.session.dropItem(data, center);
    if (!drop) {
      this.dropNotice.emit('Não foi possível largar este item aqui.');
      return;
    }
    this.session.tool.set('select');
    this.session.selectDrop(drop.id);
  }

  // --- Colar token (Ctrl+V) ------------------------------------------------

  /**
   * Cola os tokens copiados sob o mouse ou, com o mouse fora do mapa, no centro da área livre
   * entre as barras: o primeiro (o principal ao copiar) fica ali, alinhado à grade se ela estiver
   * visível, e os demais na mesma formação. Retorna false se não colou.
   */
  pasteTokens(): boolean {
    const copied = this.session.copiedTokens()[0];
    if (!copied) return false;
    const el = this.stage().nativeElement;
    const i = this.insets();
    const screen = this.pointerAt ?? {
      x: i.left + (el.clientWidth - i.left - i.right) / 2,
      y: i.top + (el.clientHeight - i.top - i.bottom) / 2,
    };
    const p = unproject(this.view(), this.matrix(), screen.x, screen.y);
    const center = this.snapping() ? snapTokenCenter(p, copied.size, this.gridSize()) : p;
    if (!this.session.pasteTokens(center).length) return false;
    this.session.tool.set('select');
    return true;
  }

  // --- Internos ------------------------------------------------------------

  private placeToken(entryId: string, p: Point): void {
    const entry = this.session.entryById().get(entryId);
    if (!entry) return;
    const size = this.session.tokenOf(entry).size;
    const center = this.snapping() ? snapTokenCenter(p, size, this.gridSize()) : p;
    if (this.session.placeToken(entryId, center)) this.session.tool.set('select');
  }

  /** Alinhar à grade neste gesto? (grade visível e sem Shift) */
  private snapOn(event: MouseEvent): boolean {
    return this.snapping() && !event.shiftKey;
  }

  /** Ponto alinhado ao canto da grade, se o alinhamento estiver ativo. */
  private snapCorner(p: Point, event: MouseEvent): Point {
    return this.snapOn(event) ? snapToCorner(p, this.gridSize()) : p;
  }

  private startPan(event: PointerEvent): void {
    const { x, y } = this.view();
    this.gesture = { kind: 'pan', sx: event.clientX, sy: event.clientY, ox: x, oy: y };
    this.panning.set(true);
    this.capture(event);
  }

  /** Mantém o gesto no mapa mesmo se o ponteiro passar por cima de outras camadas. */
  private capture(event: PointerEvent): void {
    this.stage().nativeElement.setPointerCapture(event.pointerId);
  }

  /** Deslocamento do mouse na tela (px) → deslocamento no mapa (desfaz zoom e projeção). */
  private screenDelta(dx: number, dy: number): Point {
    const s = this.scale();
    return apply(invert(this.matrix()), { x: dx / s, y: dy / s });
  }

  /** Converte a posição do mouse para coordenadas do mapa. */
  private toWorld(event: MouseEvent): Point {
    const { x, y } = this.toScreen(event);
    return unproject(this.view(), this.matrix(), x, y);
  }

  /** Posição do mouse relativa à área do mapa (px de tela). */
  private toScreen(event: MouseEvent): Point {
    const rect = this.stage().nativeElement.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /**
   * Duplo clique detectado manualmente: com a captura do ponteiro, o `dblclick`
   * nativo é redirecionado para o mapa e perderia o token clicado.
   */
  private isDoubleTap(key: string, event: MouseEvent): boolean {
    const now = performance.now();
    const last = this.lastTap;
    const hit =
      last.key === key && now - last.time < DOUBLE_TAP_MS && Math.hypot(event.clientX - last.x, event.clientY - last.y) < 6;
    this.lastTap = hit ? { key: '', time: 0, x: 0, y: 0 } : { key, time: now, x: event.clientX, y: event.clientY };
    return hit;
  }

  private addPing(p: Point): void {
    const ping = { ...p, id: newId() };
    this.pings.update((list) => [...list, ping]);
    setTimeout(() => this.pings.update((list) => list.filter((x) => x.id !== ping.id)), 1300);
  }
}
