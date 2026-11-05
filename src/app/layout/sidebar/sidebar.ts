import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { ServerAccountService, shortAccountId } from '../../core/services/server-account.service';
import { GameTablesService } from '../../core/services/game-tables.service';
import { World } from '../../core/models/world.model';
import { ServerWorldsService } from '../../core/services/server-worlds.service';
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

/** Um mundo na barra lateral: do servidor ou guardado neste navegador. */
interface WorldLink {
  id: string;
  name: string;
  local: boolean;
  /** Primeiro dos mundos deste navegador: recebe o título da seção. */
  firstLocal: boolean;
}

/**
 * Barra lateral principal: navegação entre páginas, os mundos do usuário (cada um abre
 * o Worldbuild dele), atalhos para as mesas e área da conta. Recolhível no desktop e gaveta no mobile.
 */
@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, RouterLinkActive, MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule],
  templateUrl: './sidebar.html',
  host: { class: 'contents' },
})
export class Sidebar {
  readonly layout = inject(LayoutService);
  readonly account = inject(ServerAccountService);
  private readonly actions = inject(QuickActionsService);
  private readonly tables = inject(GameTablesService);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);

  // --- Páginas -------------------------------------------------------------
  /** O convidado vê só as mesas dele; o resto é do dono do app. */
  readonly links = computed<NavLink[]>(() => {
    const tables: NavLink = { label: 'Minhas mesas', icon: 'groups', route: '/mesas' };
    if (!this.account.isOwner()) return [tables];
    return [
      { label: 'Início', icon: 'home', route: '/' },
      tables,
      { label: 'Arquivos', icon: 'perm_media', route: '/arquivos' },
      { label: 'Worldbuild', icon: 'public', route: '/worldbuild' },
    ];
  });
  readonly shortId = shortAccountId;

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
  private readonly worlds = inject(WorldsService);
  private readonly serverWorlds = inject(ServerWorldsService);
  /** Endereço atual: diz qual mundo está aberto. */
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );
  /** Mundos deste navegador com conteúdo. O "Meu mundo" vazio não aparece ao lado dos do servidor. */
  private readonly filledLocal = signal<World[]>([]);

  /** Primeiro os mundos do servidor, os das mesas online; depois os deste navegador. */
  readonly worldLinks = computed<WorldLink[]>(() => {
    const local = this.serverWorlds.worlds().length ? this.filledLocal() : this.worlds.worlds();
    return [
      ...this.serverWorlds.worlds().map((w) => ({ id: w.id, name: w.name, local: false, firstLocal: false })),
      ...local.map((w, i) => ({ id: w.id, name: w.name, local: true, firstLocal: i === 0 && this.serverWorlds.worlds().length > 0 })),
    ];
  });

  constructor() {
    // Confere de novo ao mudar de página: um mundo local pode ter ganhado o primeiro item
    effect((onCleanup) => {
      this.url();
      this.worlds.worlds();
      let cancelled = false;
      onCleanup(() => (cancelled = true));
      untracked(() => {
        void this.worlds.withContent().then((list) => {
          if (!cancelled) this.filledLocal.set(list);
        });
      });
    });
  }

  /** Mundo aberto agora no Worldbuild? (destaque na lista) */
  isOpenWorld(link: WorldLink): boolean {
    const url = this.url();
    if (!url.startsWith('/worldbuild')) return false;
    const params = this.router.parseUrl(url).queryParams;
    return link.local ? !params['servidor'] && link.id === this.worlds.activeId() : params['servidor'] === link.id;
  }

  /** Abre o mundo no Worldbuild. */
  openWorld(link: WorldLink): void {
    this.layout.closeMobile();
    if (link.local) {
      this.worlds.select(link.id);
      void this.router.navigate(['/worldbuild'], { queryParams: { local: 1 } });
    } else {
      void this.router.navigate(['/worldbuild'], { queryParams: { servidor: link.id } });
    }
  }

  /** Rótulos visíveis? (expandida no desktop ou gaveta aberta no mobile) */
  readonly expanded = computed(() => this.layout.isMobile() || !this.layout.collapsed());

  // --- Ações ---------------------------------------------------------------

  async logout(): Promise<void> {
    await this.account.logout();
    await this.router.navigate(['/entrar']);
    this.snackBar.open('Você saiu da sua conta.');
  }
}
