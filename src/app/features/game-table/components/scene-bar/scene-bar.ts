import { Component, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { GameTable } from '../../../../core/models/game-table.model';
import { Scene } from '../../../../core/models/table-session.model';
import { AutoFocus } from '../../../../shared/directives/auto-focus.directive';
import { TableSessionService } from '../../services/table-session.service';

/**
 * Barra superior da mesa: voltar, nome da mesa, abas de cenas/mapas
 * e controles de visibilidade das barras (modo imersivo, tela cheia).
 */
@Component({
  selector: 'app-scene-bar',
  imports: [RouterLink, MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule, AutoFocus],
  templateUrl: './scene-bar.html',
})
export class SceneBar {
  readonly session = inject(TableSessionService);
  readonly table = input.required<GameTable>();

  readonly renamingId = signal<string | null>(null);
  private replaceTarget: string | null = null;

  // --- Cenas ---------------------------------------------------------------

  /** Abre o seletor de imagem para uma nova cena ou para trocar o mapa de uma cena. */
  pickMap(input: HTMLInputElement, sceneId: string | null = null): void {
    this.replaceTarget = sceneId;
    input.click();
  }

  async onMapPicked(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (this.replaceTarget) await this.session.setSceneMap(this.replaceTarget, file);
    else await this.session.addScene(file);
  }

  finishRename(scene: Scene, value: string): void {
    if (this.renamingId() !== scene.id) return;
    if (value.trim()) this.session.updateScene(scene.id, { name: value.trim() });
    this.renamingId.set(null);
  }

  /** Tamanho atual da grade de uma cena (lido do estado, não do menu). */
  gridOf(sceneId: string): number {
    return this.session.scenes().find((s) => s.id === sceneId)?.gridSize ?? 70;
  }

  /** Ajusta o tamanho da grade (em px da imagem). */
  changeGrid(sceneId: string, delta: number): void {
    const size = Math.min(300, Math.max(20, this.gridOf(sceneId) + delta));
    this.session.updateScene(sceneId, { gridSize: size });
  }

  remove(scene: Scene): void {
    if (confirm(`Excluir a cena "${scene.name}"?`)) this.session.removeScene(scene.id);
  }

  // --- Tela cheia ----------------------------------------------------------

  toggleFullscreen(): void {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  }
}
