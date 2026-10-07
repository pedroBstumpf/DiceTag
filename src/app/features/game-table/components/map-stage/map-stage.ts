import { Component, DestroyRef, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Point } from '../../../../core/models/geometry.model';
import { METERS_PER_SQUARE, Wall } from '../../../../core/models/table-session.model';
import { newId } from '../../../../core/utils/id';
import { Viewport, fitRect, screenToWorld, worldToScreen, zoomAt } from '../../../../shared/utils/viewport';
import { TableSessionService } from '../../services/table-session.service';
import { distanceToPolyline, sizeFromHandle, snapToCorner, snapTokenCenter } from '../../utils/geometry';
import { simplifyPath } from '../../utils/simplify';
import { distanceToWall, handleAt, moveWallHandle, translateWall } from '../../utils/walls';
import { DoorsLayer } from '../map-layers/doors-layer/doors-layer';
import { DrawingsLayer, StrokeDraft } from '../map-layers/drawings-layer/drawings-layer';
import { FogLayer } from '../map-layers/fog-layer/fog-layer';
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
  | { kind: 'token'; id: string; size: number; sx: number; sy: number; cx: number; cy: number }
  | { kind: 'resize'; id: string; cx: number; cy: number }
  | { kind: 'circle'; cx: number; cy: number }
  | { kind: 'door'; a: Point }
  /** Editar parede: `handle` = índice da alça arrastada, ou -1 para mover a parede inteira. */
  | { kind: 'wall'; sx: number; sy: number; original: Wall; handle: number }
  | { kind: 'draw' }
  | { kind: 'erase' }
  | { kind: 'note'; id: string; sx: number; sy: number; nx: number; ny: number; moved: boolean };

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
/** Velocidade do token movido pelo teclado (quadrados por segundo); Shift multiplica. */
const KEY_SPEED = 2;
const KEY_SPEED_FAST = 2.5;

/**
 * Mapa central da mesa — orquestrador das camadas.
 *
 * Cuida de zoom (roda do mouse, no cursor), pan, conversão tela↔mundo e do
 * roteamento do ponteiro conforme a ferramenta ativa. Cada camada
 * (map-layers/) só desenha e avisa interações; as mutações passam pelo
 * TableSessionService.
 *
 * Ordem das camadas no "mundo", de baixo para cima:
 *   mapa → grade → desenhos → notas → névoa → tokens visíveis → portas → paredes → régua e ping
 * Acima do mundo fica a interface (popover de anotação, avisos).
 */
@Component({
  selector: 'app-map-stage',
  imports: [MatIconModule, MatTooltipModule, DrawingsLayer, NotesLayer, FogLayer, TokensLayer, DoorsLayer, WallsLayer, NotePopover],
  templateUrl: './map-stage.html',
  host: { class: 'block' },
})
export class MapStage {
  readonly session = inject(TableSessionService);

  /** Espaço reservado pelas barras (para centralizar o mapa na área livre). */
  readonly insets = input({ top: 0, right: 0, bottom: 0, left: 0 });
  /** Duplo clique num token: abrir a janela "Token". */
  readonly tokenOpened = output<string>();

  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');

  // --- Vista ---------------------------------------------------------------
  readonly view = signal<Viewport>({ x: 0, y: 0, scale: 1 });
  readonly scale = computed(() => this.view().scale);
  readonly src = signal<string | null>(null);
  readonly world = signal(EMPTY_WORLD);

  // --- Interações ----------------------------------------------------------
  readonly panning = signal(false);
  readonly ruler = signal<{ from: Point; to: Point } | null>(null);
  readonly pings = signal<(Point & { id: string })[]>([]);
  /** Parede sendo desenhada (ferramenta Névoa). */
  readonly wallDraft = signal<WallDraft | null>(null);
  /** Traço em andamento (ferramenta Desenhar). */
  readonly strokeDraft = signal<StrokeDraft | null>(null);
  /** Traços tocados pela borracha no gesto atual (removidos de uma vez ao soltar). */
  readonly erasing = signal<ReadonlySet<string>>(new Set());

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
    const p = worldToScreen(this.view(), note);
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

  /** Cursor conforme a ferramenta ativa. */
  readonly cursor = computed(() => {
    if (this.panning()) return 'grabbing';
    const tool = this.session.tool();
    if (tool === 'fog') {
      const mode = this.session.wallMode();
      return mode === 'erase' ? 'pointer' : mode === 'edit' ? 'move' : 'crosshair';
    }
    if (tool === 'draw') return this.session.brush().eraser ? 'cell' : 'crosshair';
    return tool === 'ruler' || tool === 'ping' || tool === 'note' ? 'crosshair' : 'grab';
  });

  private gesture: Gesture | null = null;
  private lastTap = { key: '', time: 0, x: 0, y: 0 };
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

    // Trocar de ferramenta, de modo ou de cena descarta a parede em construção
    effect(() => {
      this.session.tool();
      this.session.wallMode();
      this.sceneId();
      this.wallDraft.set(null);
    });
  }

  // --- Zoom e enquadramento ------------------------------------------------

  onImageLoad(img: HTMLImageElement): void {
    this.setWorld(this.mapKey().sceneId, { w: img.naturalWidth, h: img.naturalHeight });
    this.fit();
  }

  /** Tamanho do mundo (mapa) — também informado à sessão, junto com a cena a que pertence. */
  private setWorld(sceneId: string | undefined, size: { w: number; h: number }): void {
    this.world.set(size);
    this.session.worldSize.set(sceneId ? { sceneId, ...size } : null);
  }

  /** Enquadra o mapa inteiro na área livre entre as barras. */
  fit(): void {
    const el = this.stage().nativeElement;
    const i = this.insets();
    const { w, h } = this.world();
    this.view.set(
      fitRect(
        { x: 0, y: 0, width: w, height: h },
        { x: i.left, y: i.top, width: el.clientWidth - i.left - i.right, height: el.clientHeight - i.top - i.bottom },
      ),
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

    // Botão do meio sempre move o mapa; Selecionar/Mover arrastam o fundo
    if (event.button === 1 || (event.button === 0 && (tool === 'pan' || tool === 'select'))) {
      event.preventDefault();
      if (tool === 'select') this.session.selectedTokenId.set(null);
      this.startPan(event);
      return;
    }
    if (event.button !== 0) return;

    const p = this.toWorld(event);
    if (tool === 'ruler') {
      this.ruler.set({ from: p, to: p });
      this.gesture = { kind: 'ruler' };
      this.capture(event);
    } else if (tool === 'ping') {
      this.addPing(p);
    } else if (tool === 'fog') {
      this.onFogDown(event, p);
    } else if (tool === 'draw') {
      this.onDrawDown(event, p);
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
    let dx = (event.clientX - g.sx) / this.scale();
    let dy = (event.clientY - g.sy) / this.scale();
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

  /** Token pressionado: seleciona, move (com snap) ou redimensiona. Duplo clique abre a janela. */
  onTokenDown({ event, token, mode }: TokenPointerDown): void {
    const id = token.placement.id;
    this.openNoteId.set(null);
    this.session.selectedTokenId.set(id);
    const { x: cx, y: cy } = token.placement;

    if (mode === 'resize') {
      this.gesture = { kind: 'resize', id, cx, cy };
    } else {
      if (this.isDoubleTap(id, event)) {
        this.tokenOpened.emit(id);
        return;
      }
      this.gesture = { kind: 'token', id, size: token.size, sx: event.clientX, sy: event.clientY, cx, cy };
    }
    this.capture(event);
  }

  // --- Ponteiro: movimento e fim -------------------------------------------

  onPointerMove(event: PointerEvent): void {
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
      const s = this.scale();
      let p = { x: g.cx + (event.clientX - g.sx) / s, y: g.cy + (event.clientY - g.sy) / s };
      // Snap ao centro do quadrado (Shift ou grade escondida: livre)
      if (this.snapOn(event)) p = snapTokenCenter(p, g.size, this.gridSize());
      const current = this.session.tokens().find((t) => t.id === g.id);
      if (current && (current.x !== p.x || current.y !== p.y)) this.session.moveToken(g.id, p);
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
    } else if (g.kind === 'note') {
      const dx = event.clientX - g.sx;
      const dy = event.clientY - g.sy;
      if (!g.moved && Math.hypot(dx, dy) > 3) g.moved = true;
      if (g.moved) this.session.moveNote(g.id, { x: g.nx + dx / this.scale(), y: g.ny + dy / this.scale() });
    }
  }

  onPointerUp(): void {
    const g = this.gesture;
    this.gesture = null;
    this.panning.set(false);
    this.ruler.set(null);

    if (g?.kind === 'note' && !g.moved) this.openNoteId.set(g.id);
    if (g?.kind === 'draw') this.finishStroke();
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

  // --- Teclado (encaminhado pela página da mesa) ---------------------------

  /** Trata Enter/Esc/Delete conforme a ferramenta e a seleção. Retorna true se a tecla foi usada. */
  handleKey(event: KeyboardEvent): boolean {
    if (event.key === 'Escape' && this.openNoteId()) {
      this.openNoteId.set(null);
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
    const wallId = this.editingWalls() ? this.session.selectedWallId() : null;
    if (wallId && (event.key === 'Delete' || event.key === 'Backspace')) {
      this.session.removeWall(wallId);
      return true;
    }
    if (wallId && event.key === 'Escape') {
      this.session.selectedWallId.set(null);
      return true;
    }

    const tokenId = this.session.selectedTokenId();

    // WASD/setas: desliza o token selecionado enquanto a tecla estiver pressionada
    const key = event.key.toLowerCase();
    if (tokenId && this.selecting() && MOVE_KEYS[key]) {
      this.keyFast = event.shiftKey;
      if (!this.heldKeys.has(key)) {
        this.heldKeys.add(key);
        if (!this.keyFrame) this.keyFrame = requestAnimationFrame((t) => this.glide(t, t));
      }
      return true;
    }

    if ((event.key === 'Delete' || event.key === 'Backspace') && tokenId) {
      this.session.removeToken(tokenId);
      return true;
    }
    if (event.key === 'Escape' && tokenId) {
      this.session.selectedTokenId.set(null);
      return true;
    }
    return false;
  }

  /** Soltar uma tecla de movimento; ao soltar todas, o token se alinha à grade (se visível). */
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

    const id = this.session.selectedTokenId();
    const token = id ? this.session.resolvedTokenById(id) : null;
    if (token && this.snapping()) this.session.moveToken(token.placement.id, snapTokenCenter(token.placement, token.size, this.gridSize()));
  }

  /** Um quadro do movimento por teclado: velocidade constante, independente da taxa de quadros. */
  private glide(now: number, last: number): void {
    const id = this.session.selectedTokenId();
    const token = id ? this.session.resolvedTokenById(id) : null;
    if (!token || !this.heldKeys.size) {
      this.keyFrame = 0;
      return;
    }
    let dx = 0;
    let dy = 0;
    for (const key of this.heldKeys) {
      dx += MOVE_KEYS[key].x;
      dy += MOVE_KEYS[key].y;
    }
    const len = Math.hypot(dx, dy);
    if (len) {
      // Diagonal com a mesma velocidade; no máximo 50ms por quadro (aba em segundo plano)
      const dt = Math.min(now - last, 50) / 1000;
      const step = (KEY_SPEED * (this.keyFast ? KEY_SPEED_FAST : 1) * this.gridSize() * dt) / len;
      this.session.moveToken(token.placement.id, { x: token.placement.x + dx * step, y: token.placement.y + dy * step });
    }
    this.keyFrame = requestAnimationFrame((t) => this.glide(t, now));
  }

  // --- Arrastar fichas do painel para o mapa -------------------------------

  onDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes(TOKEN_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }

  onDrop(event: DragEvent): void {
    const entryId = event.dataTransfer?.getData(TOKEN_DRAG_TYPE);
    if (!entryId) return;
    event.preventDefault();
    this.placeToken(entryId, this.toWorld(event));
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

  /** Converte a posição do mouse para coordenadas do mapa. */
  private toWorld(event: MouseEvent): Point {
    const rect = this.stage().nativeElement.getBoundingClientRect();
    return screenToWorld(this.view(), event.clientX - rect.left, event.clientY - rect.top);
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
