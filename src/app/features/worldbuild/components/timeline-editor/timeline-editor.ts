import { Component, ElementRef, afterNextRender, computed, inject, input, signal, viewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Point } from '../../../../core/models/geometry.model';
import { TIMELINE_COLORS, TimelineEvent, TimelineLink } from '../../../../core/models/world-item.model';
import { newId } from '../../../../core/utils/id';
import { AutoFocus } from '../../../../shared/directives/auto-focus.directive';
import { Viewport, fitRect, screenToWorld, zoomAt } from '../../../../shared/utils/viewport';
import { WorldbuildService } from '../../services/worldbuild.service';
import {
  CardSide,
  TIMELINE_CARD,
  cardAt,
  cardsBounds,
  linkPath,
  placeConnected,
  sideAnchor,
  treeLayout,
} from '../../utils/timeline-layout';

/** Passo da grade (snap com Shift e pontos do fundo). */
const GRID = 24;
const MIN_SCALE = 0.2;
const MAX_SCALE = 2.5;
/** Intervalo máximo entre dois cliques para contar como duplo clique (ms). */
const DOUBLE_TAP_MS = 350;

/** Gesto de ponteiro em andamento no quadro. */
type Drag =
  | { kind: 'pan'; sx: number; sy: number; ox: number; oy: number }
  | { kind: 'card'; id: string; sx: number; sy: number; ex: number; ey: number }
  | { kind: 'link'; fromId: string; side: CardSide; sx: number; sy: number; moved: boolean };

/** Posição da alça "+" em cada lado do cartão selecionado. */
const HANDLE_CLASS: Record<CardSide, string> = {
  top: 'left-1/2 -top-3 -translate-x-1/2',
  right: '-right-3 top-1/2 -translate-y-1/2',
  bottom: 'left-1/2 -bottom-3 -translate-x-1/2',
  left: '-left-3 top-1/2 -translate-y-1/2',
};

/**
 * Editor de linha do tempo em mapa mental (estilo Mindomo).
 *
 * Eventos são cartões posicionados livremente num quadro com pan e zoom,
 * ligados por setas — permite ramificações e eventos paralelos.
 * - Duplo clique no fundo ou "+ Evento": cria evento
 * - Alças "+" do cartão selecionado: clique cria evento conectado; arraste conecta a outro cartão
 * - Arrastar cartão move (Shift alinha à grade); Delete remove o evento ou a seta selecionada
 * Salva automaticamente (o serviço agrupa as gravações).
 */
@Component({
  selector: 'app-timeline-editor',
  imports: [MatButtonModule, MatIconModule, MatTooltipModule, AutoFocus],
  templateUrl: './timeline-editor.html',
  host: { class: 'flex h-full flex-col outline-none', tabindex: '-1', '(keydown)': 'onKeydown($event)' },
})
export class TimelineEditor {
  private readonly service = inject(WorldbuildService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');

  readonly itemId = input.required<string>();

  // --- Dados ---------------------------------------------------------------
  private readonly item = computed(() => this.service.byId().get(this.itemId()));
  readonly events = computed(() => this.item()?.events ?? []);
  readonly links = computed(() => this.item()?.links ?? []);
  private readonly eventById = computed(() => new Map(this.events().map((e) => [e.id, e])));

  /** Setas já calculadas (só recalculam quando eventos ou conexões mudam). */
  readonly linkShapes = computed(() => {
    const byId = this.eventById();
    return this.links().flatMap((link) => {
      const from = byId.get(link.from);
      const to = byId.get(link.to);
      return from && to ? [{ link, ...linkPath(pos(from), pos(to)) }] : [];
    });
  });

  readonly colors = TIMELINE_COLORS;
  readonly card = TIMELINE_CARD;
  readonly sides: CardSide[] = ['top', 'right', 'bottom', 'left'];
  readonly handleClass = HANDLE_CLASS;

  // --- Estado da vista e da seleção ----------------------------------------
  readonly view = signal<Viewport>({ x: 40, y: 40, scale: 1 });
  readonly selectedId = signal<string | null>(null);
  readonly selectedLinkId = signal<string | null>(null);
  readonly editingId = signal<string | null>(null);
  /** Seta provisória enquanto se arrasta uma alça até outro cartão. */
  readonly linkDraft = signal<{ from: Point; to: Point } | null>(null);
  readonly panning = signal(false);

  /** Grade de pontos do fundo, acompanhando pan e zoom. */
  readonly grid = computed(() => {
    const v = this.view();
    const size = GRID * v.scale;
    return { size: `${size}px ${size}px`, position: `${v.x}px ${v.y}px` };
  });

  private drag: Drag | null = null;
  private lastTap = { key: '', time: 0, x: 0, y: 0 };

  constructor() {
    // Enquadra os eventos quando a janela abre
    afterNextRender(() => this.fitAll());
  }

  // --- Toolbar -------------------------------------------------------------

  /** Cria um evento no centro da vista. */
  addAtCenter(): void {
    const el = this.stage().nativeElement;
    const c = screenToWorld(this.view(), el.clientWidth / 2, el.clientHeight / 2);
    this.createAt({ x: c.x - TIMELINE_CARD.width / 2, y: c.y - TIMELINE_CARD.height / 2 });
  }

  /** Ajusta o zoom para mostrar todos os eventos. */
  fitAll(): void {
    const el = this.stage().nativeElement;
    const bounds = cardsBounds(this.events().map(pos));
    if (!bounds) {
      this.view.set({ x: 40, y: 40, scale: 1 });
      return;
    }
    this.view.set(fitRect(bounds, { x: 0, y: 0, width: el.clientWidth, height: el.clientHeight }, 0.9, 1.2));
  }

  /** Organiza em árvore da esquerda para a direita e enquadra o resultado. */
  autoLayout(): void {
    const positions = treeLayout(
      this.events().map((e) => e.id),
      this.links(),
    );
    this.saveEvents(this.events().map((e) => ({ ...e, ...positions.get(e.id) })));
    this.fitAll();
  }

  // --- Edição de eventos ---------------------------------------------------

  /** Atualiza campos de um evento. */
  change(id: string, patch: Partial<TimelineEvent>): void {
    this.saveEvents(this.events().map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  /** Remove um evento e as setas ligadas a ele. */
  removeEvent(id: string): void {
    this.service.update(this.itemId(), {
      events: this.events().filter((e) => e.id !== id),
      links: this.links().filter((l) => l.from !== id && l.to !== id),
    });
    if (this.selectedId() === id) this.selectedId.set(null);
    if (this.editingId() === id) this.editingId.set(null);
  }

  setLinkLabel(id: string, label: string): void {
    this.saveLinks(this.links().map((l) => (l.id === id ? { ...l, label: label || undefined } : l)));
  }

  removeLink(id: string): void {
    this.saveLinks(this.links().filter((l) => l.id !== id));
    if (this.selectedLinkId() === id) this.selectedLinkId.set(null);
  }

  startEditing(id: string): void {
    this.selectedId.set(id);
    this.editingId.set(id);
  }

  finishEditing(): void {
    this.editingId.set(null);
    this.focusHost();
  }

  // --- Ponteiro ------------------------------------------------------------

  /** Fundo: duplo clique cria evento; arrastar move o quadro. */
  onStageDown(event: PointerEvent): void {
    if (event.button !== 0 && event.button !== 1) return;
    this.focusHost();
    this.selectedId.set(null);
    this.selectedLinkId.set(null);
    this.editingId.set(null);

    if (event.button === 0 && this.isDoubleTap('fundo', event)) {
      const p = this.toWorld(event);
      this.createAt({ x: p.x - TIMELINE_CARD.width / 2, y: p.y - TIMELINE_CARD.height / 2 });
      return;
    }
    const { x, y } = this.view();
    this.drag = { kind: 'pan', sx: event.clientX, sy: event.clientY, ox: x, oy: y };
    this.panning.set(true);
    this.capture(event);
  }

  /** Cartão: seleciona e começa a mover (duplo clique abre a edição). */
  onCardDown(event: PointerEvent, ev: TimelineEvent): void {
    event.stopPropagation();
    // Campos e botões do cartão funcionam normalmente
    if (event.button !== 0 || (event.target as HTMLElement).closest('input, textarea, button')) return;

    this.focusHost();
    this.selectedId.set(ev.id);
    this.selectedLinkId.set(null);
    if (this.isDoubleTap(ev.id, event)) {
      this.startEditing(ev.id);
      return;
    }
    if (this.editingId() === ev.id) return;
    this.drag = { kind: 'card', id: ev.id, sx: event.clientX, sy: event.clientY, ex: pos(ev).x, ey: pos(ev).y };
    this.capture(event);
  }

  /** Alça "+": clique cria evento conectado; arrastar até outro cartão cria a seta. */
  onHandleDown(event: PointerEvent, ev: TimelineEvent, side: CardSide): void {
    event.stopPropagation();
    event.preventDefault();
    if (event.button !== 0) return;
    this.drag = { kind: 'link', fromId: ev.id, side, sx: event.clientX, sy: event.clientY, moved: false };
    this.capture(event);
  }

  onLinkDown(event: PointerEvent, link: TimelineLink): void {
    event.stopPropagation();
    this.focusHost();
    this.selectedLinkId.set(link.id);
    this.selectedId.set(null);
    this.editingId.set(null);
  }

  onPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag) return;
    const dx = event.clientX - drag.sx;
    const dy = event.clientY - drag.sy;

    if (drag.kind === 'pan') {
      this.view.update((v) => ({ ...v, x: drag.ox + dx, y: drag.oy + dy }));
    } else if (drag.kind === 'card') {
      const s = this.view().scale;
      let x = drag.ex + dx / s;
      let y = drag.ey + dy / s;
      if (event.shiftKey) {
        x = Math.round(x / GRID) * GRID;
        y = Math.round(y / GRID) * GRID;
      }
      this.change(drag.id, { x, y });
    } else {
      if (!drag.moved && Math.hypot(dx, dy) > 4) drag.moved = true;
      const from = this.eventById().get(drag.fromId);
      if (drag.moved && from) this.linkDraft.set({ from: sideAnchor(pos(from), drag.side), to: this.toWorld(event) });
    }
  }

  onPointerUp(event: PointerEvent): void {
    const drag = this.drag;
    this.drag = null;
    this.panning.set(false);
    this.linkDraft.set(null);
    if (drag?.kind !== 'link') return;

    if (!drag.moved) {
      this.createConnected(drag.fromId, drag.side);
      return;
    }
    const target = cardAt(this.events().map((e) => ({ ...e, ...pos(e) })), this.toWorld(event));
    if (target && target.id !== drag.fromId) this.addLink(drag.fromId, target.id);
  }

  onWheel(event: WheelEvent): void {
    event.preventDefault();
    const rect = this.stage().nativeElement.getBoundingClientRect();
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    this.view.update((v) => zoomAt(v, factor, event.clientX - rect.left, event.clientY - rect.top, MIN_SCALE, MAX_SCALE));
  }

  // --- Teclado -------------------------------------------------------------

  /** Delete remove o evento/seta selecionado; Esc limpa a seleção. */
  onKeydown(event: KeyboardEvent): void {
    const typing = (event.target as HTMLElement).closest('input, textarea');
    if (typing) {
      if (event.key === 'Escape') this.finishEditing();
      // Não deixa os atalhos da mesa reagirem enquanto se digita aqui
      event.stopPropagation();
      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      const linkId = this.selectedLinkId();
      const eventId = this.selectedId();
      if (linkId) this.removeLink(linkId);
      else if (eventId) this.removeEvent(eventId);
      else return;
    } else if (event.key === 'Escape') {
      this.selectedId.set(null);
      this.selectedLinkId.set(null);
      this.editingId.set(null);
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  // --- Internos ------------------------------------------------------------

  private createAt(p: Point): void {
    const event = this.newEvent(p);
    this.saveEvents([...this.events(), event]);
    this.startEditing(event.id);
  }

  /** Cria um evento ao lado de outro, já conectado a ele. */
  private createConnected(fromId: string, side: CardSide): void {
    const from = this.eventById().get(fromId);
    if (!from) return;
    const event = this.newEvent(placeConnected(pos(from), side, this.events().map(pos)));
    this.service.update(this.itemId(), {
      events: [...this.events(), event],
      links: [...this.links(), { id: newId(), from: fromId, to: event.id }],
    });
    this.startEditing(event.id);
  }

  private addLink(from: string, to: string): void {
    if (this.links().some((l) => l.from === from && l.to === to)) return;
    this.saveLinks([...this.links(), { id: newId(), from, to }]);
  }

  private newEvent(p: Point): TimelineEvent {
    return {
      id: newId(),
      title: '',
      date: '',
      description: '',
      color: TIMELINE_COLORS[this.events().length % TIMELINE_COLORS.length],
      x: Math.round(p.x),
      y: Math.round(p.y),
    };
  }

  private saveEvents(events: TimelineEvent[]): void {
    this.service.update(this.itemId(), { events });
  }

  private saveLinks(links: TimelineLink[]): void {
    this.service.update(this.itemId(), { links });
  }

  private toWorld(event: MouseEvent): Point {
    const rect = this.stage().nativeElement.getBoundingClientRect();
    return screenToWorld(this.view(), event.clientX - rect.left, event.clientY - rect.top);
  }

  /** Mantém o gesto no quadro mesmo se o ponteiro sair dele. */
  private capture(event: PointerEvent): void {
    this.stage().nativeElement.setPointerCapture(event.pointerId);
  }

  /** O foco no editor faz Delete/Esc chegarem aqui (e não à página). */
  private focusHost(): void {
    this.host.nativeElement.focus({ preventScroll: true });
  }

  /**
   * Duplo clique detectado manualmente: com a captura do ponteiro, o evento
   * `dblclick` nativo é redirecionado para o quadro e perderia o alvo.
   */
  private isDoubleTap(key: string, event: PointerEvent): boolean {
    const now = performance.now();
    const last = this.lastTap;
    const hit = last.key === key && now - last.time < DOUBLE_TAP_MS && Math.hypot(event.clientX - last.x, event.clientY - last.y) < 6;
    this.lastTap = hit ? { key: '', time: 0, x: 0, y: 0 } : { key, time: now, x: event.clientX, y: event.clientY };
    return hit;
  }
}

/** Posição de um evento (migrado ao carregar; o fallback só protege dados inválidos). */
function pos(e: TimelineEvent): Point {
  return { x: e.x ?? 0, y: e.y ?? 0 };
}
