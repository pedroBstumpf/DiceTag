import { Component, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MAX_MAP_LEVELS } from '../../../../core/models/table-session.model';
import { AutoFocus } from '../../../../shared/directives/auto-focus.directive';
import { BlobUrlService } from '../../services/blob-url.service';
import { LevelView, TableSessionService, levelOf } from '../../services/table-session.service';

/**
 * Painel de camadas do mapa (mestre, vista isométrica), ao lado da barra de ferramentas.
 *
 * Mostra as camadas como um prédio (a de cima no topo): clicar foca a camada (a pilha
 * desliza na tela), o olho libera a camada para os jogadores, e o menu de cada uma
 * envia/remove a imagem, renomeia ou exclui. Camada sem imagem = "ar" (mostra a de
 * baixo: tokens nela parecem voar). Também sobe/desce o token selecionado.
 */
@Component({
  selector: 'app-levels-menu',
  imports: [MatIconModule, MatMenuModule, MatTooltipModule, AutoFocus],
  host: { class: 'glass block w-72 rounded-xl p-3 shadow-xl shadow-black/40' },
  template: `
    <header class="mb-2 flex items-center gap-2">
      <mat-icon class="!size-5 !text-[20px] text-astral-300">layers</mat-icon>
      <h4 class="flex-1 font-display text-sm tracking-wide text-star-300">Camadas do mapa</h4>
      <span class="text-[11px] tabular-nums text-slate-500">{{ session.levelCount() }}/{{ max }}</span>
      <button type="button" class="grid size-7 place-items-center rounded-md text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Fechar" (click)="session.levelsOpen.set(false)">
        <mat-icon class="!text-[18px]">close</mat-icon>
      </button>
    </header>

    <!-- Camadas, de cima para baixo -->
    <ol class="flex flex-col gap-1">
      @for (level of levelsTopDown(); track level.id) {
        @let focused = level.index === session.currentLevel();
        @let forPlayers = level.index === session.playerLevel();
        <li
          class="group flex h-12 cursor-pointer items-center gap-2 rounded-lg pl-1.5 pr-1 transition-colors"
          [class]="focused ? 'bg-astral-500/20 ring-1 ring-astral-400/50' : 'hover:bg-white/5'"
          (click)="renamingIndex() !== level.index && session.viewLevel(level.index)"
          (dblclick)="level.index > 0 && renamingIndex.set(level.index)"
        >
          <!-- Miniatura (ou "ar") -->
          <span class="relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-md bg-ink-950/70 ring-1 ring-white/10">
            @if (blobs.url(level.blobId); as src) {
              <img [src]="src" alt="" class="size-full object-cover" />
            } @else if (level.index === 0) {
              <mat-icon class="!size-5 !text-[20px] text-slate-500">grid_on</mat-icon>
            } @else {
              <mat-icon class="!size-5 !text-[20px] text-sky-300/70" matTooltip="Sem imagem: ar (mostra a camada de baixo)">air</mat-icon>
            }
            <span class="absolute bottom-0 left-0 rounded-tr bg-ink-950/90 px-1 text-[9px] font-semibold text-slate-300">{{ level.index + 1 }}</span>
          </span>

          <!-- Nome -->
          <div class="min-w-0 flex-1 leading-tight">
            @if (renamingIndex() === level.index) {
              <input
                #nameInput
                appAutoFocus
                class="h-7 w-full rounded bg-ink-950 px-2 text-sm text-slate-100 outline-none ring-1 ring-astral-400/60"
                [value]="level.name"
                (click)="$event.stopPropagation()"
                (keydown.enter)="finishRename(level, nameInput.value)"
                (keydown.escape)="renamingIndex.set(null)"
                (blur)="finishRename(level, nameInput.value)"
              />
            } @else {
              <span class="block truncate text-sm" [class]="focused ? 'text-star-300' : 'text-slate-300'">{{ level.name }}</span>
              <span class="block truncate text-[10px] text-slate-500">
                {{ tokenCount(level.index) }} token(s){{ !level.blobId && level.index > 0 ? ' · ar' : '' }}
              </span>
            }
          </div>

          <!-- Jogadores veem esta camada -->
          <button
            type="button"
            class="grid size-7 shrink-0 place-items-center rounded-md transition-colors"
            [class]="forPlayers ? 'text-amber-300' : 'text-slate-600 opacity-0 hover:bg-white/10 hover:text-slate-300 group-hover:opacity-100'"
            [matTooltip]="forPlayers ? 'Os jogadores estão vendo esta camada' : 'Mostrar esta camada aos jogadores'"
            (click)="$event.stopPropagation(); session.showLevelToPlayers(level.index)"
          >
            <mat-icon class="!text-[18px]" [class.icon-filled]="forPlayers">visibility</mat-icon>
          </button>

          <!-- Opções -->
          <button
            type="button"
            class="grid size-7 shrink-0 place-items-center rounded-md text-slate-500 hover:bg-white/10 hover:text-white"
            aria-label="Opções da camada"
            [matMenuTriggerFor]="levelMenu"
            [matMenuTriggerData]="{ level: level }"
            (click)="$event.stopPropagation()"
          >
            <mat-icon class="!text-[18px]">more_vert</mat-icon>
          </button>
        </li>
      }
    </ol>

    <button
      type="button"
      class="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/15 text-xs text-slate-300 transition-colors hover:border-astral-400/50 hover:text-astral-300 disabled:opacity-40"
      [disabled]="session.levelCount() >= max"
      (click)="session.addLevel()"
    >
      <mat-icon class="!size-4 !text-[16px]">add</mat-icon>
      {{ session.levelCount() >= max ? 'Máximo de ' + max + ' camadas' : 'Nova camada acima' }}
    </button>

    <!-- Levar os jogadores para a camada em foco -->
    @if (session.currentLevel() !== session.playerLevel()) {
      <button
        type="button"
        class="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-amber-400/15 text-xs font-semibold text-amber-200 ring-1 ring-amber-300/30 hover:bg-amber-400/25"
        (click)="session.showLevelToPlayers(session.currentLevel())"
      >
        <mat-icon class="!size-4 !text-[16px]">visibility</mat-icon>
        Mostrar esta camada aos jogadores
      </button>
    }

    <!-- Token selecionado: subir/descer de camada -->
    @if (selected(); as t) {
      <div class="mt-3 flex items-center gap-2 border-t border-white/5 pt-3">
        <mat-icon class="!size-4 !text-[16px] text-astral-300">token</mat-icon>
        <span class="min-w-0 flex-1 truncate text-xs text-slate-300">{{ t.name }}</span>
        <button type="button" class="grid size-8 place-items-center rounded-md bg-white/5 text-slate-300 hover:bg-white/10 disabled:opacity-30" matTooltip="Descer de camada (PageDown)" [disabled]="t.level === 0" (click)="move(t.id, -1)">
          <mat-icon class="!text-[18px]">arrow_downward</mat-icon>
        </button>
        <button type="button" class="grid size-8 place-items-center rounded-md bg-white/5 text-slate-300 hover:bg-white/10 disabled:opacity-30" matTooltip="Subir de camada (PageUp)" [disabled]="t.level >= session.levelCount() - 1" (click)="move(t.id, 1)">
          <mat-icon class="!text-[18px]">arrow_upward</mat-icon>
        </button>
      </div>
    }

    <p class="mt-3 text-[11px] leading-relaxed text-slate-500">
      Camada sem imagem é <strong class="text-slate-400">ar</strong>: deixa ver a de baixo, e quem está nela parece voar.
      PageUp/PageDown sobem e descem o token selecionado (ou a camada em foco).
    </p>

    <input #fileInput type="file" accept="image/*" hidden (change)="onFilePicked(fileInput)" />

    <!-- Menu de cada camada -->
    <mat-menu #levelMenu="matMenu">
      <ng-template matMenuContent let-level="level">
        <button mat-menu-item (click)="pickImage(fileInput, level.index)">
          <mat-icon>add_photo_alternate</mat-icon>
          <span>{{ level.blobId ? 'Trocar imagem' : 'Enviar imagem' }}</span>
        </button>
        @if (level.index > 0) {
          @if (level.blobId) {
            <button mat-menu-item (click)="session.clearLevelImage(level.index)">
              <mat-icon>air</mat-icon>
              <span>Remover imagem (virar ar)</span>
            </button>
          }
          <button mat-menu-item (click)="renamingIndex.set(level.index)">
            <mat-icon>edit</mat-icon>
            <span>Renomear</span>
          </button>
          <button mat-menu-item (click)="remove(level)">
            <mat-icon class="!text-red-400">delete</mat-icon>
            <span class="text-red-300">Excluir camada</span>
          </button>
        }
      </ng-template>
    </mat-menu>
  `,
})
export class LevelsMenu {
  readonly session = inject(TableSessionService);
  readonly blobs = inject(BlobUrlService);

  readonly max = MAX_MAP_LEVELS;
  readonly renamingIndex = signal<number | null>(null);
  private uploadIndex = 0;

  /** Camadas de cima para baixo (como os andares de um prédio). */
  readonly levelsTopDown = computed(() => [...this.session.mapLevels()].reverse());

  /** Token selecionado e a camada dele. */
  readonly selected = computed(() => {
    const id = this.session.selectedTokenId();
    const token = id ? this.session.resolvedTokenById(id) : null;
    return token ? { id: token.placement.id, name: token.entry.name, level: levelOf(token.placement) } : null;
  });

  tokenCount(index: number): number {
    return this.session.tokens().filter((t) => levelOf(t) === index).length;
  }

  move(placementId: string, delta: number): void {
    this.session.moveTokenLevel(placementId, delta);
  }

  pickImage(input: HTMLInputElement, index: number): void {
    this.uploadIndex = index;
    input.click();
  }

  async onFilePicked(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (file?.type.startsWith('image/')) await this.session.setLevelImage(this.uploadIndex, file);
  }

  finishRename(level: LevelView, value: string): void {
    if (this.renamingIndex() !== level.index) return;
    this.session.renameLevel(level.index, value);
    this.renamingIndex.set(null);
  }

  remove(level: LevelView): void {
    if (confirm(`Excluir a camada "${level.name}"? Os tokens dela descem uma camada.`)) this.session.removeLevel(level.index);
  }
}
