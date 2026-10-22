import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { APP_MODE } from '../../core/config/app-mode';
import { AuthService } from '../../core/services/auth.service';
import { GameTablesService } from '../../core/services/game-tables.service';
import { WorldsService } from '../../core/services/worlds.service';
import { LayoutService } from '../../core/services/layout.service';
import { QuickActionsService } from '../../shared/services/quick-actions.service';

/** Quantas mesas aparecem na barra (as demais ficam em "Ver todas"). */
const MAX_SIDEBAR_TABLES = 6;

/** Item de navegação (página). */
interface NavLink {
  label: string;
  icon: string;
  route: string;
}

/**
 * Barra lateral principal: navegação entre páginas, os mundos do usuário (cada um abre
 * o Worldbuild dele), atalhos para as mesas e área da conta (com o modo em uso — online ou
 * offline — e a troca de modo). Recolhível no desktop e gaveta no mobile.
 */
@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, RouterLinkActive, MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule],
  templateUrl: './sidebar.html',
  host: { class: 'contents' },
})
export class Sidebar {
  readonly layout = inject(LayoutService);
  readonly auth = inject(AuthService);
  /** Online: conta no servidor (mostra "sair de todos os dispositivos"). */
  readonly online = inject(APP_MODE) === 'online';
  private readonly actions = inject(QuickActionsService);
  private readonly tables = inject(GameTablesService);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);

  // --- Páginas -------------------------------------------------------------
  readonly links: NavLink[] = [
    { label: 'Início', icon: 'home', route: '/' },
    { label: 'Minhas mesas', icon: 'groups', route: '/mesas' },
    { label: 'Worldbuild', icon: 'public', route: '/worldbuild' },
  ];

  // --- Mesas do usuário (atalhos) ------------------------------------------
  /** Mesas exibidas na barra: as mais recentes primeiro. */
  readonly recentTables = computed(() => this.tables.tables().slice(0, MAX_SIDEBAR_TABLES));
  /** Mesas que não couberam (link "Ver todas"). */
  readonly hiddenTables = computed(() => Math.max(0, this.tables.tables().length - MAX_SIDEBAR_TABLES));

  createTable(): void {
    this.layout.closeMobile();
    this.actions.createTable();
  }

  // --- Mundos --------------------------------------------------------------
  readonly worlds = inject(WorldsService);
  /** Página atual é o Worldbuild? (destaca o mundo aberto) */
  readonly onWorldbuild = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url.startsWith('/worldbuild')),
    ),
    { initialValue: this.router.url.startsWith('/worldbuild') },
  );

  /** Abre o mundo no Worldbuild. */
  openWorld(id: string): void {
    this.worlds.select(id);
    this.layout.closeMobile();
    void this.router.navigate(['/worldbuild']);
  }

  /** Rótulos visíveis? (expandida no desktop ou gaveta aberta no mobile) */
  readonly expanded = computed(() => this.layout.isMobile() || !this.layout.collapsed());

  // --- Ações ---------------------------------------------------------------

  openAuth(mode: 'login' | 'register'): void {
    this.layout.closeMobile();
    this.actions.openAuth(mode);
  }

  async logout(): Promise<void> {
    await this.signOut(() => this.auth.logout(), 'Você saiu da sua conta.');
  }

  /** Online: encerra a sessão em todos os computadores (inclusive este). */
  async logoutEverywhere(): Promise<void> {
    if (!confirm('Sair da conta em todos os computadores e navegadores, inclusive neste?')) return;
    await this.signOut(() => this.auth.logoutAll(), 'Você saiu da conta em todos os dispositivos.');
  }

  /** Online ou offline (trocar recarrega o app). */
  changeMode(): void {
    this.layout.closeMobile();
    void this.actions.chooseMode();
  }

  private async signOut(action: () => Promise<void>, done: string): Promise<void> {
    try {
      await action();
      this.snackBar.open(done);
    } catch {
      // A conta já saiu deste navegador; o servidor encerra a sessão quando vencer
      this.snackBar.open('Você saiu, mas o servidor não respondeu.');
    }
    this.router.navigate(['/']);
  }
}
