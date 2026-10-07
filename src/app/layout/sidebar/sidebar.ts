import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { LayoutService } from '../../core/services/layout.service';
import { WorldbuildService } from '../../features/worldbuild/services/worldbuild.service';
import { QuickActionsService } from '../../shared/services/quick-actions.service';

/** Item de navegação (página). */
interface NavLink {
  label: string;
  icon: string;
  route: string;
}

/** Ação de criação rápida. */
interface CreateAction {
  label: string;
  icon: string;
  run: () => void;
}

/**
 * Barra lateral principal: navegação entre páginas, atalhos de criação,
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
  private readonly worldbuild = inject(WorldbuildService);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);

  // --- Páginas -------------------------------------------------------------
  readonly links: NavLink[] = [
    { label: 'Início', icon: 'home', route: '/' },
    { label: 'Minhas mesas', icon: 'groups', route: '/mesas' },
    { label: 'Worldbuild', icon: 'public', route: '/worldbuild' },
  ];

  // --- Criação rápida ------------------------------------------------------
  readonly createActions: CreateAction[] = [
    { label: 'Nova mesa', icon: 'add_circle', run: () => this.actions.createTable() },
    { label: 'Novo documento', icon: 'note_add', run: () => this.actions.createWorldItem('document') },
    { label: 'Nova linha do tempo', icon: 'timeline', run: () => this.actions.createWorldItem('timeline') },
    { label: 'Nova pasta', icon: 'create_new_folder', run: () => this.actions.createWorldItem('folder') },
  ];

  // --- Recursos planejados (exibidos como "em breve") ----------------------
  readonly upcoming = [
    { label: 'Fichas de personagem', icon: 'badge' },
    { label: 'Rolador de dados', icon: 'casino' },
  ];

  /** Rótulos visíveis? (expandida no desktop ou gaveta aberta no mobile) */
  readonly expanded = computed(() => this.layout.isMobile() || !this.layout.collapsed());

  // --- Ações ---------------------------------------------------------------

  run(action: CreateAction): void {
    this.layout.closeMobile();
    action.run();
  }

  /** Envio de mapa/imagem: o seletor de arquivos abre aqui (gesto do usuário). */
  async pickMap(input: HTMLInputElement): Promise<void> {
    if (!(await this.actions.ensureAuth())) return;
    input.click();
  }

  async uploadMap(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    const item = await this.worldbuild.uploadImage(file);
    this.layout.closeMobile();
    this.router.navigate(['/worldbuild'], { queryParams: { abrir: item.id } });
  }

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
