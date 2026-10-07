import { Component, ElementRef, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { newId } from '../../../../core/utils/id';
import { TableSessionService } from '../../services/table-session.service';

const MIN_SCALE = 0.1;
const MAX_SCALE = 6;
/** Tamanho do "papel quadriculado" quando a cena ainda não tem mapa. */
const EMPTY_WORLD = { w: 2100, h: 1400 };
/** Metros por quadrado da grade (padrão da maioria dos sistemas). */
const METERS_PER_SQUARE = 1.5;

interface Point {
  x: number;
  y: number;
}

/**
 * Mapa central da mesa.
 * - Zoom com a roda do mouse (no ponto do cursor) e botões
 * - Mover o mapa: ferramenta "Mover"/"Selecionar" ou botão do meio do mouse
 * - Régua: arraste para medir em quadrados e metros
 * - Ping: clique para chamar atenção num ponto do mapa
 * - Grade sobreposta ao mapa (tamanho configurável por cena)
 */
@Component({
  selector: 'app-map-stage',
  imports: [MatIconModule, MatTooltipModule],
  templateUrl: './map-stage.html',
  host: { class: 'block' },
})
export class MapStage {
  readonly session = inject(TableSessionService);

  /** Espaço reservado pelas barras (para centralizar o mapa na área livre). */
  readonly insets = input({ top: 0, right: 0, bottom: 0, left: 0 });

  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');

  // --- Estado da visualização ----------------------------------------------
  readonly src = signal<string | null>(null);
  readonly world = signal(EMPTY_WORLD);
  readonly scale = signal(1);
  readonly offset = signal<Point>({ x: 0, y: 0 });

  // --- Interações ----------------------------------------------------------
  readonly panning = signal(false);
  readonly ruler = signal<{ from: Point; to: Point } | null>(null);
  readonly pings = signal<(Point & { id: string })[]>([]);

  readonly scene = this.session.activeScene;
  /** Muda só quando troca a cena ou o mapa (não ao ajustar a grade). */
  private readonly mapKey = computed(() => ({ sceneId: this.scene()?.id, blobId: this.scene()?.blobId }), {
    equal: (a, b) => a.sceneId === b.sceneId && a.blobId === b.blobId,
  });
  private panStart = { x: 0, y: 0, ox: 0, oy: 0 };

  readonly gridSize = computed(() => this.scene()?.gridSize ?? 70);

  /** Distância da régua em quadrados e metros. */
  readonly rulerLabel = computed(() => {
    const r = this.ruler();
    const grid = this.scene()?.gridSize ?? 70;
    if (!r) return '';
    const squares = Math.hypot(r.to.x - r.from.x, r.to.y - r.from.y) / grid;
    return `${squares.toFixed(1)} quad. · ${(squares * METERS_PER_SQUARE).toFixed(1)} m`;
  });

  /** Cursor conforme a ferramenta ativa. */
  readonly cursor = computed(() => {
    if (this.panning()) return 'grabbing';
    const tool = this.session.tool();
    return tool === 'ruler' || tool === 'ping' ? 'crosshair' : 'grab';
  });

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

  // --- Zoom ----------------------------------------------------------------

  onImageLoad(img: HTMLImageElement): void {
    this.world.set({ w: img.naturalWidth, h: img.naturalHeight });
    this.fit();
  }

  /** Enquadra o mapa inteiro na área livre entre as barras. */
  fit(): void {
    const el = this.stage().nativeElement;
    const i = this.insets();
    const areaW = el.clientWidth - i.left - i.right;
    const areaH = el.clientHeight - i.top - i.bottom;
    const { w, h } = this.world();
    const s = Math.min(areaW / w, areaH / h) * 0.95;
    this.scale.set(s);
    this.offset.set({ x: i.left + (areaW - w * s) / 2, y: i.top + (areaH - h * s) / 2 });
  }

  zoomBy(factor: number, cx?: number, cy?: number): void {
    const el = this.stage().nativeElement;
    const px = cx ?? el.clientWidth / 2;
    const py = cy ?? el.clientHeight / 2;
    const old = this.scale();
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, old * factor));
    const { x, y } = this.offset();
    this.scale.set(next);
    this.offset.set({ x: px - ((px - x) * next) / old, y: py - ((py - y) * next) / old });
  }

  onWheel(event: WheelEvent): void {
    event.preventDefault();
    const rect = this.stage().nativeElement.getBoundingClientRect();
    this.zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX - rect.left, event.clientY - rect.top);
  }

  // --- Ponteiro (ferramentas) ----------------------------------------------

  onPointerDown(event: PointerEvent): void {
    const tool = this.session.tool();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);

    // Botão do meio sempre move o mapa
    if (event.button === 1 || (event.button === 0 && (tool === 'pan' || tool === 'select'))) {
      event.preventDefault();
      const { x, y } = this.offset();
      this.panStart = { x: event.clientX, y: event.clientY, ox: x, oy: y };
      this.panning.set(true);
      return;
    }
    if (event.button !== 0) return;

    const p = this.toWorld(event);
    if (tool === 'ruler') this.ruler.set({ from: p, to: p });
    if (tool === 'ping') this.addPing(p);
  }

  onPointerMove(event: PointerEvent): void {
    if (this.panning()) {
      this.offset.set({
        x: this.panStart.ox + event.clientX - this.panStart.x,
        y: this.panStart.oy + event.clientY - this.panStart.y,
      });
    } else if (this.ruler()) {
      this.ruler.update((r) => (r ? { ...r, to: this.toWorld(event) } : r));
    }
  }

  onPointerUp(): void {
    this.panning.set(false);
    this.ruler.set(null);
  }

  // --- Internos ------------------------------------------------------------

  /** Converte a posição do mouse para coordenadas do mapa. */
  private toWorld(event: PointerEvent): Point {
    const rect = this.stage().nativeElement.getBoundingClientRect();
    const { x, y } = this.offset();
    const s = this.scale();
    return { x: (event.clientX - rect.left - x) / s, y: (event.clientY - rect.top - y) / s };
  }

  private addPing(p: Point): void {
    const ping = { ...p, id: newId() };
    this.pings.update((list) => [...list, ping]);
    setTimeout(() => this.pings.update((list) => list.filter((x) => x.id !== ping.id)), 1300);
  }
}
