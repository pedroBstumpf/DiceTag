import { BreakpointObserver } from '@angular/cdk/layout';
import { Injectable, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

const COLLAPSED_KEY = 'dicetag.sidebarCollapsed';

/**
 * Estado global do layout: barra lateral recolhida/aberta e modo mobile.
 * - Desktop: a barra alterna entre expandida e só-ícones (lembra a escolha).
 * - Mobile: a barra vira uma gaveta que abre por cima do conteúdo.
 */
@Injectable({ providedIn: 'root' })
export class LayoutService {
  /** true em telas menores que 1024px. */
  readonly isMobile = toSignal(
    inject(BreakpointObserver).observe('(max-width: 1023.98px)').pipe(map((r) => r.matches)),
    { initialValue: false },
  );

  /** Desktop: barra recolhida (apenas ícones). */
  readonly collapsed = signal(localStorage.getItem(COLLAPSED_KEY) === 'true');

  /** Mobile: gaveta aberta. */
  readonly mobileOpen = signal(false);

  constructor() {
    // Lembra a preferência do usuário entre visitas
    effect(() => localStorage.setItem(COLLAPSED_KEY, String(this.collapsed())));
  }

  /** Alterna a barra conforme o tipo de tela. */
  toggleSidebar(): void {
    if (this.isMobile()) this.mobileOpen.update((v) => !v);
    else this.collapsed.update((v) => !v);
  }

  /** Fecha a gaveta mobile (ex.: após navegar). */
  closeMobile(): void {
    this.mobileOpen.set(false);
  }
}
