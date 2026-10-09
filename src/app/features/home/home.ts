import { DatePipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { MAX_WORLDS } from '../../core/models/world.model';
import { GameTablesService } from '../../core/services/game-tables.service';
import { WorldsService } from '../../core/services/worlds.service';
import { NewsService } from '../../core/services/news.service';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { QuickActionsService } from '../../shared/services/quick-actions.service';

/** Cartão de atalho exibido abaixo do banner. */
interface FeatureCard {
  icon: string;
  title: string;
  text: string;
  cta: string;
  run: () => void;
}

/**
 * Página inicial (landing): banner com a logo, atalhos principais
 * (mesas, worldbuild, mundos) e o mural de notícias e anúncios.
 */
@Component({
  selector: 'app-home',
  imports: [RouterLink, DatePipe, MatButtonModule, MatIconModule, EmptyState],
  templateUrl: './home.html',
})
export class Home {
  readonly auth = inject(AuthService);
  readonly actions = inject(QuickActionsService);
  readonly news = inject(NewsService);
  private readonly tables = inject(GameTablesService);
  private readonly worlds = inject(WorldsService);

  /** Saudação personalizada quando logado. */
  readonly greeting = computed(() => {
    const name = this.auth.isGuest() ? null : this.auth.user()?.name;
    return name ? `Bem-vindo de volta, ${name}.` : 'Sua mesa de RPG online, do mundo à rolagem.';
  });

  // --- Atalhos principais --------------------------------------------------
  readonly features = computed<FeatureCard[]>(() => [
    {
      icon: 'groups',
      title: 'Mesas de jogo',
      text: this.auth.isLoggedIn()
        ? `Você tem ${this.tables.tables().length} mesa(s). Crie uma nova e chame seus amigos.`
        : 'Crie mesas para suas campanhas e reúna seu grupo em um só lugar.',
      cta: 'Criar mesa',
      run: () => this.actions.createTable(),
    },
    {
      icon: 'public',
      title: 'Worldbuild',
      text: 'Linhas do tempo, mapas, raças, NPCs e documentos — organizados em pastas do seu jeito.',
      cta: 'Abrir worldbuild',
      run: () => this.actions.openWorldbuild(),
    },
    {
      icon: 'travel_explore',
      title: 'Mundos',
      text: this.auth.isLoggedIn()
        ? `Você tem ${this.worlds.worlds().length} de ${MAX_WORLDS} mundos. Cada mesa se passa em um deles.`
        : 'Cada mundo é um worldbuild próprio; cada mesa se passa em um deles.',
      cta: 'Ver mundos',
      run: () => this.actions.openWorldbuild(),
    },
  ]);
}
