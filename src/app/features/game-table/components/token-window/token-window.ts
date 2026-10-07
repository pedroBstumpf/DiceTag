import { Component, computed, inject, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { BlobUrlService } from '../../services/blob-url.service';
import { TableSessionService } from '../../services/table-session.service';
import { TokenEditor } from '../token-editor/token-editor';

/**
 * Janela "Token" (duplo clique num token do mapa) — único lugar das opções do token:
 * imagem, tamanho, visão, barras e etiquetas. As alterações respeitam a regra de
 * vínculo (TableSessionService.updateToken): personagem altera a ficha e todos os
 * tokens dele; NPC altera só este token. Imagem e visão valem sempre para a ficha.
 */
@Component({
  selector: 'app-token-window',
  imports: [MatButtonModule, MatIconModule, MatTooltipModule, TokenEditor],
  host: { class: 'flex h-full flex-col overflow-y-auto p-5' },
  template: `
    @if (token(); as t) {
      <div class="mb-5 flex items-center gap-3">
        <!-- Imagem (clique para trocar) -->
        <button
          type="button"
          class="group relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-full border-2 border-white/70 bg-ink-700"
          [matTooltip]="t.blobId ? 'Trocar imagem' : 'Enviar imagem'"
          (click)="imageInput.click()"
        >
          @if (blobs.url(t.blobId); as src) {
            <img [src]="src" alt="" class="size-full object-cover" />
          } @else {
            <span class="font-display text-2xl text-white">{{ t.entry.name.charAt(0).toUpperCase() }}</span>
          }
          <span class="absolute inset-0 grid place-items-center bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
            <mat-icon class="text-white">add_photo_alternate</mat-icon>
          </span>
        </button>
        <input #imageInput type="file" accept="image/*" hidden (change)="onImagePicked(imageInput, t.entry.id)" />

        <div class="min-w-0 flex-1">
          <p class="truncate font-display text-lg text-star-300">{{ t.entry.name }}</p>
          <p class="flex items-center gap-1 text-xs" [class]="t.linked ? 'text-astral-300' : 'text-violet-300'">
            <mat-icon class="!size-4 !text-[16px]">{{ t.linked ? 'link' : 'link_off' }}</mat-icon>
            {{ t.linked ? 'Vinculado à ficha: vale para todos os tokens dele' : 'Token independente: vale só para este' }}
          </p>
        </div>
      </div>

      <app-token-editor [value]="t" (changed)="session.updateToken(t.placement.id, $event)" />

      <div class="mt-6 flex flex-wrap gap-2 border-t border-white/5 pt-4">
        <button mat-stroked-button (click)="openEntry.emit(t.entry.id)">
          <mat-icon>badge</mat-icon>
          Abrir ficha
        </button>
        @if (!t.linked) {
          <button mat-stroked-button matTooltip="Os próximos tokens deste NPC começam com estes valores" (click)="saveAsDefault(t.placement.id)">
            <mat-icon>save</mat-icon>
            Usar como padrão do NPC
          </button>
        }
        <button mat-button class="!text-red-300" (click)="session.removeToken(t.placement.id)">
          <mat-icon>delete</mat-icon>
          Remover do mapa
        </button>
      </div>
    }
  `,
})
export class TokenWindow {
  readonly session = inject(TableSessionService);
  readonly blobs = inject(BlobUrlService);
  private readonly snackBar = inject(MatSnackBar);

  /** Id do token colocado (TokenPlacement). */
  readonly placementId = input.required<string>();
  /** Pedido para abrir a ficha do personagem/NPC. */
  readonly openEntry = output<string>();

  readonly token = computed(() => this.session.resolvedTokenById(this.placementId()));

  /** Envia (ou troca) a imagem — vale para a ficha e todos os tokens dela. */
  async onImagePicked(input: HTMLInputElement, entryId: string): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (file?.type.startsWith('image/')) await this.session.setTokenImage(entryId, file);
  }

  saveAsDefault(placementId: string): void {
    this.session.saveTokenAsDefault(placementId);
    this.snackBar.open('Padrão do NPC atualizado.');
  }
}
