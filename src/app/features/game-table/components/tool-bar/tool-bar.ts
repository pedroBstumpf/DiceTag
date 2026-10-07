import { Component, inject, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TableTool } from '../../../../core/models/table-session.model';
import { TableSessionService } from '../../services/table-session.service';
import { DrawMenu } from '../draw-menu/draw-menu';
import { FogMenu } from '../fog-menu/fog-menu';
import { FxMenu } from '../fx-menu/fx-menu';

/** Definição de uma ferramenta exibida na barra. */
export interface ToolDef {
  id: TableTool;
  icon: string;
  label: string;
  /** Tecla de atalho. */
  key: string;
  /** Ainda não implementada (aparece desabilitada). */
  soon?: boolean;
}

/** Ferramentas da mesa, na ordem em que aparecem. */
export const TABLE_TOOLS: ToolDef[] = [
  { id: 'select', icon: 'arrow_selector_tool', label: 'Selecionar', key: 'V' },
  { id: 'pan', icon: 'pan_tool', label: 'Mover mapa', key: 'M' },
  { id: 'ruler', icon: 'straighten', label: 'Régua', key: 'R' },
  { id: 'ping', icon: 'my_location', label: 'Ping', key: 'P' },
  { id: 'draw', icon: 'draw', label: 'Desenhar', key: 'D' },
  { id: 'fog', icon: 'cloud', label: 'Névoa de guerra', key: 'F' },
  { id: 'note', icon: 'sticky_note_2', label: 'Anotação no mapa', key: 'N' },
  { id: 'fx', icon: 'auto_awesome', label: 'Efeitos especiais', key: 'E' },
];

/**
 * Barra de ferramentas (lateral esquerda da mesa):
 * ferramentas de mapa, grade e controles de zoom.
 * Ferramentas com opções (ex.: Névoa) abrem um submenu ao lado da barra.
 */
@Component({
  selector: 'app-tool-bar',
  imports: [MatIconModule, MatTooltipModule, DrawMenu, FogMenu, FxMenu],
  templateUrl: './tool-bar.html',
})
export class ToolBar {
  readonly session = inject(TableSessionService);
  readonly tools = TABLE_TOOLS;

  readonly zoomIn = output<void>();
  readonly zoomOut = output<void>();
  readonly fit = output<void>();
  readonly hide = output<void>();

  /** Liga/desliga a grade da cena ativa. */
  toggleGrid(): void {
    const scene = this.session.activeScene();
    if (scene) this.session.updateScene(scene.id, { showGrid: !scene.showGrid });
  }
}
