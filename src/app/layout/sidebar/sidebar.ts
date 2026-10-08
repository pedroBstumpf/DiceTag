import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { LayoutService } from '../../core/services/layout.service';
import { QuickActionsService } from '../../shared/services/quick-actions.service';

/** Item de navegação (página). */
interface NavLink {
  label: string;
  icon: string;
  route: string;
}

/**
 * Barra lateral principal: navegação entre páginas, Lore geral do mundo,
 * recursos futuros e área da conta. Recolhível no desktop e gaveta no mobile.
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
  private readonly actions = inject(QuickActionsService);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);

  // --- Páginas -------------------------------------------------------------
  readonly links: NavLink[] = [
    { label: 'Início', icon: 'home', route: '/' },
    { label: 'Minhas mesas', icon: 'groups', route: '/mesas' },
    { label: 'Worldbuild', icon: 'public', route: '/worldbuild' },
  ];

  // --- Recursos planejados (exibidos como "em breve") ----------------------
  readonly upcoming = [{ label: 'Rolador de dados', icon: 'casino' }];

  /** Rótulos visíveis? (expandida no desktop ou gaveta aberta no mobile) */
  readonly expanded = computed(() => this.layout.isMobile() || !this.layout.collapsed());

  // --- Ações ---------------------------------------------------------------

  openAuth(mode: 'login' | 'register'): void {
    this.layout.closeMobile();
    this.actions.openAuth(mode);
  }

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/']);
    this.snackBar.open('Você saiu da sua conta.');
  }
}
