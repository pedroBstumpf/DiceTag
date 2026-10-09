import { Injectable, signal } from '@angular/core';
import { WindowGeometry } from '../components/floating-window/window-geometry';

/** Janela aberta numa área de trabalho (worldbuild, mesa de jogo…). */
export interface OpenWindow {
  /** Id do conteúdo exibido (item, ficha, som…). Uma janela por conteúdo. */
  id: string;
  geometry: WindowGeometry;
  maximized: boolean;
  minimized: boolean;
  pinned: boolean;
  z: number;
}

/** Tamanho padrão de uma nova janela. */
const DEFAULT_SIZE = { width: 720, height: 560 };
const CASCADE_STEP = 28;

/**
 * Controla um conjunto de janelas flutuantes: abrir, fechar, trazer
 * para frente e lembrar posição/tamanho/estado.
 * Fornecido no componente de cada página (`providers: [WindowManagerService]`),
 * para que cada área de trabalho tenha suas próprias janelas.
 */
@Injectable()
export class WindowManagerService {
  private readonly _windows = signal<OpenWindow[]>([]);
  readonly windows = this._windows.asReadonly();

  /** Janela em foco (a de maior z-index). */
  readonly activeId = signal<string | null>(null);

  private topZ = 1;

  /**
   * Abre a janela de um conteúdo (ou foca/restaura, se já estiver aberta).
   * `area` é o tamanho da área de trabalho, para posicionar e caber na tela.
   */
  open(id: string, area: { width: number; height: number }, size = DEFAULT_SIZE): void {
    if (this._windows().some((w) => w.id === id)) {
      this.patch(id, { minimized: false });
      this.focus(id);
      return;
    }

    // Posição em cascata para as janelas não ficarem empilhadas exatamente
    const offset = (this._windows().length % 6) * CASCADE_STEP;
    const width = Math.min(size.width, area.width - 32);
    const height = Math.min(size.height, area.height - 32);
    const geometry: WindowGeometry = {
      width,
      height,
      x: Math.max(16, Math.min((area.width - width) / 2 + offset, area.width - width - 16)),
      y: Math.max(16, Math.min(40 + offset, area.height - height - 16)),
    };

    this._windows.update((list) => [
      ...list,
      { id, geometry, maximized: false, minimized: false, pinned: false, z: ++this.topZ },
    ]);
    this.activeId.set(id);
  }

  /** Traz a janela para frente. */
  focus(id: string): void {
    if (this.activeId() === id) return;
    this.patch(id, { z: ++this.topZ });
    this.activeId.set(id);
  }

  close(id: string): void {
    this.closeMany([id]);
  }

  /** Fecha várias janelas (ex.: itens excluídos). */
  closeMany(idsToClose: string[]): void {
    const ids = new Set(idsToClose);
    this._windows.update((list) => list.filter((w) => !ids.has(w.id)));

    // Passa o foco para a janela que estiver mais à frente
    if (this.activeId() && ids.has(this.activeId()!)) {
      const top = [...this._windows()].sort((a, b) => b.z - a.z)[0];
      this.activeId.set(top?.id ?? null);
    }
  }

  /** Atualiza posição, tamanho ou estado de uma janela. */
  patch(id: string, changes: Partial<Omit<OpenWindow, 'id'>>): void {
    this._windows.update((list) => list.map((w) => (w.id === id ? { ...w, ...changes } : w)));
  }

  /** Substitui todas as janelas (restaura uma área de trabalho salva). A de maior z-index fica em foco. */
  restore(list: OpenWindow[]): void {
    this._windows.set(list);
    this.topZ = Math.max(1, ...list.map((w) => w.z));
    this.activeId.set([...list].sort((a, b) => b.z - a.z)[0]?.id ?? null);
  }
}
