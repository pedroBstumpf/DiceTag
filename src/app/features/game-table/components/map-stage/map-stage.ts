import { Component, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Point } from '../../../../core/models/geometry.model';
import { METERS_PER_SQUARE } from '../../../../core/models/table-session.model';
import { newId } from '../../../../core/utils/id';
import { Viewport, fitRect, screenToWorld, zoomAt } from '../../../../shared/utils/viewport';
import { TableSessionService } from '../../services/table-session.service';
import { distanceToPolyline, sizeFromHandle, snapToCorner, snapTokenCenter } from '../../utils/geometry';
import { FogLayer } from '../map-layers/fog-layer/fog-layer';
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
  | { kind: 'circle'; cx: number; cy: number };

/**
 * Mapa central da mesa — orquestrador das camadas.
 *
 * Cuida de zoom (roda do mouse, no cursor), pan, conversão tela↔mundo e do
 * roteamento do ponteiro conforme a ferramenta ativa. Cada camada
 * (map-layers/) só desenha e avisa interações; as mutações passam pelo
 * TableSessionService.
 *
 * Ordem das camadas no "mundo", de baixo para cima:
 *   mapa → grade → névoa → tokens visíveis → paredes → régua e ping
 */
@Component({
  selector: 'app-map-stage',
  imports: [MatIconModule, MatTooltipModule, TokensLayer, FogLayer, WallsLayer],
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

  readonly scene = this.session.activeScene;
  readonly gridSize = computed(() => this.scene()?.gridSize ?? 70);
  /** Muda só quando troca a cena ou o mapa (não ao ajustar a grade). */
  private readonly mapKey = computed(() => ({ sceneId: this.scene()?.id, blobId: this.scene()?.blobId }), {
    equal: (a, b) => a.sceneId === b.sceneId && a.blobId === b.blobId,
  });

  /** Tokens e anotações recebem o ponteiro só na ferramenta Selecionar. */
  readonly selecting = computed(() => this.session.tool() === 'select');

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
    if (tool === 'fog') return this.session.wallMode() === 'erase' ? 'pointer' : 'crosshair';
    return tool === 'ruler' || tool === 'ping' ? 'crosshair' : 'grab';
  });

  private gesture: Gesture | null = null;
  private lastTap = { key: '', time: 0, x: 0, y: 0 };
  /** Muda só ao trocar de cena (editar a cena não altera). */
  private readonly sceneId = computed(() => this.scene()?.id);

  constructor() {
    // Carrega a imagem da cena ativa (ou usa o papel quadriculado)
    effect(async (onCleanup) => {
      const { blobId } = this.mapKey();
      if (!blobId) {
        this.src.set(null);
        this.world.set(EMPTY_WORLD);
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
    this.world.set({ w: img.naturalWidth, h: img.naturalHeight });
    this.fit();
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

  /** Centro da área livre (entre as barras), em coordenadas do mapa. */
  centerWorld(): Point {
    const el = this.stage().nativeElement;
    const i = this.insets();
    const sx = i.left + (el.clientWidth - i.left - i.right) / 2;
    const sy = i.top + (el.clientHeight - i.top - i.bottom) / 2;
    return screenToWorld(this.view(), sx, sy);
  }

  // --- Ponteiro: fundo do mapa ---------------------------------------------

  onPointerDown(event: PointerEvent): void {
    const tool = this.session.tool();

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
    } else {
      this.addLinePoint(event, p);
    }
  }

  /** Parede em linha, clique a clique: duplo clique ou clicar no ponto inicial finaliza. */
  private addLinePoint(event: PointerEvent, raw: Point): void {
    const p = event.shiftKey ? raw : snapToCorner(raw, this.gridSize());
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

  /** Parede sob o ponto (a mais recente primeiro), com tolerância constante na tela. */
  private wallAt(p: Point) {
    const tolerance = HIT_TOLERANCE / this.scale();
    return [...this.session.walls()]
      .reverse()
      .find((w) =>
        w.kind === 'line'
          ? distanceToPolyline(p, w.points) < tolerance
          : Math.abs(Math.hypot(p.x - w.cx, p.y - w.cy) - w.r) < tolerance,
      );
  }

  // --- Ponteiro: tokens ----------------------------------------------------

  /** Token pressionado: seleciona, move (com snap) ou redimensiona. Duplo clique abre a janela. */
  onTokenDown({ event, token, mode }: TokenPointerDown): void {
    const id = token.placement.id;
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
      this.wallDraft.set({ ...draft, cursor: event.shiftKey ? raw : snapToCorner(raw, this.gridSize()) });
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
      // Snap ao centro do quadrado (Shift posiciona livre)
      if (!event.shiftKey) p = snapTokenCenter(p, g.size, this.gridSize());
      const current = this.session.tokens().find((t) => t.id === g.id);
      if (current && (current.x !== p.x || current.y !== p.y)) this.session.moveToken(g.id, p);
    } else if (g.kind === 'resize') {
      const size = sizeFromHandle({ x: g.cx, y: g.cy }, this.toWorld(event), this.gridSize());
      if (this.session.resolvedTokenById(g.id)?.size !== size) this.session.updateToken(g.id, { size });
    } else if (g.kind === 'circle') {
      const p = this.toWorld(event);
      this.wallDraft.set({ kind: 'circle', cx: g.cx, cy: g.cy, r: Math.hypot(p.x - g.cx, p.y - g.cy) });
    }
  }

  onPointerUp(): void {
    const g = this.gesture;
    this.gesture = null;
    this.panning.set(false);
    this.ruler.set(null);

    // Círculo: salva ao soltar (ignora cliques sem arrastar)
    const draft = this.wallDraft();
    if (g?.kind === 'circle' && draft?.kind === 'circle') {
      if (draft.r * this.scale() > 4) this.session.addWall({ kind: 'circle', cx: draft.cx, cy: draft.cy, r: draft.r });
      this.wallDraft.set(null);
    }
  }

  // --- Teclado (encaminhado pela página da mesa) ---------------------------

  /** Trata Enter/Esc/Delete conforme a ferramenta e a seleção. Retorna true se a tecla foi usada. */
  handleKey(event: KeyboardEvent): boolean {
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

    const tokenId = this.session.selectedTokenId();
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

  /** Coloca o token de uma ficha no centro da vista (botão da janela). */
  placeAtCenter(entryId: string): void {
    this.placeToken(entryId, this.centerWorld());
  }

  // --- Internos ------------------------------------------------------------

  private placeToken(entryId: string, p: Point): void {
    const entry = this.session.entryById().get(entryId);
    if (!entry) return;
    const size = this.session.tokenOf(entry).size;
    if (this.session.placeToken(entryId, snapTokenCenter(p, size, this.gridSize()))) this.session.tool.set('select');
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
