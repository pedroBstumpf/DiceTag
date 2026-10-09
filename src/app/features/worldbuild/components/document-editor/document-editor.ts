import { Component, computed, inject, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RichTextEditor } from '../../../../shared/components/rich-text-editor/rich-text-editor';
import { WorldbuildService } from '../../services/worldbuild.service';

/**
 * Editor de documentos longos do worldbuild: título + texto rico (RichTextEditor).
 * Salva automaticamente a cada alteração (o serviço agrupa as gravações).
 */
@Component({
  selector: 'app-document-editor',
  imports: [MatIconModule, RichTextEditor],
  templateUrl: './document-editor.html',
  host: { class: 'flex h-full flex-col' },
})
export class DocumentEditor {
  private readonly service = inject(WorldbuildService);

  readonly itemId = input.required<string>();
  /** Só leitura (jogador na mesa): sem barra de formatação, sem editar texto nem título. */
  readonly readonly = input(false);
  readonly item = computed(() => this.service.byId().get(this.itemId()));

  save(content: string): void {
    if (!this.readonly()) this.service.update(this.itemId(), { content });
  }

  rename(value: string): void {
    if (!this.readonly()) this.service.rename(this.itemId(), value);
  }
}
