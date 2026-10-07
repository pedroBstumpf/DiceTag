import { Component, ElementRef, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { fitRect, zoomAt } from '../../../../shared/utils/viewport';
import { WorldbuildService } from '../../services/worldbuild.service';

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;

/**
 * Visualizador de mapas e imagens com zoom (roda do mouse / botões)
 * e navegação arrastando. Ideal para mapas grandes.
 */
@Component({
  selector: 'app-image-viewer',
  imports: [MatIconModule, MatTooltipModule],
  templateUrl: './image-viewer.html',
  host: { class: 'block h-full' },
})
export class ImageViewer {
  private readonly service = inject(WorldbuildService);

  readonly itemId = input.required<string>();
  /** Só muda quando o arquivo muda (evita recarregar a cada edição de outros itens). */
  private readonly blobId = computed(() => this.service.byId().get(this.itemId())?.blobId);
  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');

  // --- Estado --------------------------------------------------------------
  readonly src = signal<string | null>(null);
  readonly scale = signal(1);
  readonly offset = signal({ x: 0, y: 0 });
  readonly dragging = signal(false);

  private natural = { w: 0, h: 0 };
  private panStart = { x: 0, y: 0, ox: 0, oy: 0 };

  constructor() {
    // Carrega o arquivo do IndexedDB e cria uma URL temporária
    effect(async (onCleanup) => {
      const blobId = this.blobId();
      if (!blobId) return;
      // Cancela este carregamento se o arquivo mudar (ou a janela fechar) antes de terminar
      let url: string | undefined;
      let cancelled = false;
      onCleanup(() => {
        cancelled = true;
        if (url) URL.revokeObjectURL(url);
      });
      const blob = await this.service.getBlob(blobId);
      if (cancelled || !blob) return;
      url = URL.createObjectURL(blob);
      this.src.set(url);
    });
  }

  // --- Zoom ----------------------------------------------------------------

  /** Ajusta a imagem inteira dentro da área visível (sem ampliar além de 100%). */
  fit(): void {
    const el = this.stage().nativeElement;
    if (!this.natural.w) return;
    const view = fitRect(
      { x: 0, y: 0, width: this.natural.w, height: this.natural.h },
      { x: 0, y: 0, width: el.clientWidth, height: el.clientHeight },
      1,
      1,
    );
    this.scale.set(view.scale);
    this.offset.set({ x: view.x, y: view.y });
  }

  onLoad(img: HTMLImageElement): void {
    this.natural = { w: img.naturalWidth, h: img.naturalHeight };
    this.fit();
  }

  /** Zoom mantendo fixo o ponto (cx, cy) — por padrão, o centro da área. */
  zoomBy(factor: number, cx?: number, cy?: number): void {
    const el = this.stage().nativeElement;
    const view = zoomAt(
      { ...this.offset(), scale: this.scale() },
      factor,
      cx ?? el.clientWidth / 2,
      cy ?? el.clientHeight / 2,
      MIN_SCALE,
      MAX_SCALE,
    );
    this.scale.set(view.scale);
    this.offset.set({ x: view.x, y: view.y });
  }

  onWheel(event: WheelEvent): void {
    event.preventDefault();
    const rect = this.stage().nativeElement.getBoundingClientRect();
    this.zoomBy(event.deltaY < 0 ? 1.15 : 1 / 1.15, event.clientX - rect.left, event.clientY - rect.top);
  }

  // --- Navegação (arrastar) ------------------------------------------------

  startPan(event: PointerEvent): void {
    if (event.button !== 0) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const { x, y } = this.offset();
    this.panStart = { x: event.clientX, y: event.clientY, ox: x, oy: y };
    this.dragging.set(true);
  }

  pan(event: PointerEvent): void {
    if (!this.dragging()) return;
    this.offset.set({
      x: this.panStart.ox + event.clientX - this.panStart.x,
      y: this.panStart.oy + event.clientY - this.panStart.y,
    });
  }

  endPan(): void {
    this.dragging.set(false);
  }
}
