import { DatePipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { GameTablesService } from '../../core/services/game-tables.service';
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
 * (conta, mesas, worldbuild) e o mural de notícias e anúncios.
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
      text: 'Linhas do tempo, mapas, imagens e documentos — organizados em pastas do seu jeito.',
      cta: 'Abrir worldbuild',
      run: () => this.actions.openWorldbuild(),
    },
    {
      icon: 'auto_stories',
      title: 'Feito para imersão',
      text: 'Janelas que se movem, barras que se escondem: a interface sai do caminho da história.',
      cta: this.auth.isLoggedIn() ? 'Minhas mesas' : 'Criar conta',
      run: () => (this.auth.isLoggedIn() ? this.actions.goTo('/mesas') : this.actions.openAuth('register')),
    },
  ]);
}
