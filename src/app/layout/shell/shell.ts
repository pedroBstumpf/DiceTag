import { Component, inject } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { RouterLink, RouterOutlet } from '@angular/router';
import { LayoutService } from '../../core/services/layout.service';
import { QuickActionsService } from '../../shared/services/quick-actions.service';
import { Sidebar } from '../sidebar/sidebar';

/**
 * Estrutura base de todas as páginas: barra lateral + área de conteúdo.
 * No mobile, exibe uma barra superior compacta com o botão do menu.
 * Na primeira abertura neste navegador, pergunta se o app fica online ou offline.
 */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, Sidebar, MatIcon, MatIconButton],
  templateUrl: './shell.html',
})
export class Shell {
  readonly layout = inject(LayoutService);

  constructor() {
    void inject(QuickActionsService).ensureModeChosen();
  }
}
