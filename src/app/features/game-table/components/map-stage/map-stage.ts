import { Component, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Point } from '../../../../core/models/geometry.model';
import { METERS_PER_SQUARE } from '../../../../core/models/table-session.model';
import { newId } from '../../../../core/utils/id';
import { Viewport, fitRect, screenToWorld, zoomAt } from '../../../../shared/utils/viewport';
import { TableSessionService } from '../../services/table-session.service';
import { sizeFromHandle, snapTokenCenter } from '../../utils/geometry';
import { TOKEN_DRAG_TYPE, TokenPointerDown, TokensLayer } from '../map-layers/tokens-layer/tokens-layer';

const MIN_SCALE = 0.1;
const MAX_SCALE = 6;
/** Tamanho do "papel quadriculado" quando a cena ainda não tem mapa. */
const EMPTY_WORLD = { w: 2100, h: 1400 };
/** Intervalo máximo entre dois cliques para contar como duplo clique (ms). */
const DOUBLE_TAP_MS = 350;

/** Gesto de ponteiro em andamento no mapa. */
type Gesture =
  | { kind: 'pan'; sx: number; sy: number; ox: number; oy: number }
  | { kind: 'ruler' }
  | { kind: 'token'; id: string; size: number; sx: number; sy: number; cx: number; cy: number }
  | { kind: 'resize'; id: string; cx: number; cy: number };

/**
 * Mapa central da mesa — orquestrador das camadas.
 *
 * Cuida de zoom (roda do mouse, no cursor), pan, conversão tela↔mundo e do
 * roteamento do ponteiro conforme a ferramenta ativa. Cada camada
 * (map-layers/) só desenha e avisa interações; as mutações passam pelo
 * TableSessionService.
 *
 * Ordem das camadas no "mundo", de baixo para cima:
 *   mapa → grade → tokens → régua e ping
 */
@Component({
  selector: 'app-map-stage',
  imports: [MatIconModule, MatTooltipModule, TokensLayer],
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
    return tool === 'ruler' || tool === 'ping' ? 'crosshair' : 'grab';
  });

  private gesture: Gesture | null = null;
  private lastTap = { key: '', time: 0 };

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
    }
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
      if (this.isDoubleTap(id)) {
        this.tokenOpened.emit(id);
        return;
      }
      this.gesture = { kind: 'token', id, size: token.size, sx: event.clientX, sy: event.clientY, cx, cy };
    }
    this.capture(event);
  }

  // --- Ponteiro: movimento e fim -------------------------------------------

  onPointerMove(event: PointerEvent): void {
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
    }
  }

  onPointerUp(): void {
    this.gesture = null;
    this.panning.set(false);
    this.ruler.set(null);
  }

  // --- Teclado (encaminhado pela página da mesa) ---------------------------

  /** Trata Delete/Esc conforme a seleção. Retorna true se a tecla foi usada. */
  handleKey(event: KeyboardEvent): boolean {
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
  private isDoubleTap(key: string): boolean {
    const now = performance.now();
    const hit = this.lastTap.key === key && now - this.lastTap.time < DOUBLE_TAP_MS;
    this.lastTap = hit ? { key: '', time: 0 } : { key, time: now };
    return hit;
  }

  private addPing(p: Point): void {
    const ping = { ...p, id: newId() };
    this.pings.update((list) => [...list, ping]);
    setTimeout(() => this.pings.update((list) => list.filter((x) => x.id !== ping.id)), 1300);
  }
}
