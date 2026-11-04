import { Component, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { GameTable } from '../../../../core/models/game-table.model';
import { Scene, SceneFolder } from '../../../../core/models/table-session.model';
import { AutoFocus } from '../../../../shared/directives/auto-focus.directive';
import { SoundMixerService } from '../../services/sound-mixer.service';
import { TableSessionService } from '../../services/table-session.service';

/**
 * Barra superior da mesa: voltar, nome da mesa, pastas e abas de cenas/mapas,
 * vista isométrica (mestre) e controles de visibilidade das barras (modo imersivo, tela cheia).
 * Cada pasta é um botão que abre a lista das cenas dela; cenas fora de pastas viram abas.
 */
@Component({
  selector: 'app-scene-bar',
  imports: [RouterLink, MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule, AutoFocus],
  templateUrl: './scene-bar.html',
})
export class SceneBar {
  readonly session = inject(TableSessionService);
  readonly mixer = inject(SoundMixerService);
  readonly table = input.required<GameTable>();

  readonly renamingId = signal<string | null>(null);
  private replaceTarget: string | null = null;
  /** Pasta onde a próxima cena criada vai entrar (null = fora de pastas). */
  private newSceneFolder: string | null = null;

  /** O mestre organiza as cenas e escolhe a vista. */
  readonly isGm = computed(() => this.session.role() === 'gm');

  // --- Pastas --------------------------------------------------------------

  /** Cenas fora de pastas (inclui as de pastas que não existem mais). */
  readonly looseScenes = computed(() => {
    const folders = new Set(this.session.sceneFolders().map((f) => f.id));
    return this.session.scenes().filter((s) => !s.folderId || !folders.has(s.folderId));
  });

  /** Pasta da cena ativa (para destacar o botão da pasta). */
  readonly activeFolderId = computed(() => this.session.activeScene()?.folderId ?? null);

  scenesIn(folderId: string): Scene[] {
    return this.session.scenes().filter((s) => s.folderId === folderId);
  }

  createFolder(): void {
    const folder = this.session.addSceneFolder();
    this.renamingId.set(folder.id);
  }

  finishFolderRename(folder: SceneFolder, value: string): void {
    if (this.renamingId() !== folder.id) return;
    this.session.renameSceneFolder(folder.id, value);
    this.renamingId.set(null);
  }

  removeFolder(folder: SceneFolder): void {
    if (confirm(`Excluir a pasta "${folder.name}"? As cenas dela continuam, fora de pastas.`)) this.session.removeSceneFolder(folder.id);
  }

  /** Cria uma pasta e já move a cena para ela. */
  moveToNewFolder(scene: Scene): void {
    const folder = this.session.addSceneFolder();
    this.session.moveSceneToFolder(scene.id, folder.id);
    this.renamingId.set(folder.id);
  }

  /** Nova cena vazia já dentro de uma pasta. */
  async addSceneTo(folderId: string | null, input?: HTMLInputElement): Promise<void> {
    if (input) {
      this.newSceneFolder = folderId;
      this.pickMap(input);
      return;
    }
    const scene = await this.session.addScene();
    if (folderId) this.session.moveSceneToFolder(scene.id, folderId);
  }

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
    if (this.replaceTarget) {
      await this.session.setSceneMap(this.replaceTarget, file);
      return;
    }
    const scene = await this.session.addScene(file);
    if (this.newSceneFolder) this.session.moveSceneToFolder(scene.id, this.newSceneFolder);
    this.newSceneFolder = null;
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
