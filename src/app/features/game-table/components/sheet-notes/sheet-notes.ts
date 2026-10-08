import { Component, computed, inject, input, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NotePage } from '../../../../core/models/table-session.model';
import { newId } from '../../../../core/utils/id';
import { RichTextEditor } from '../../../../shared/components/rich-text-editor/rich-text-editor';
import { TableSessionService } from '../../services/table-session.service';

/**
 * Aba Anotações da ficha: um caderno com páginas. À esquerda, a lista de
 * páginas (criar, renomear, excluir); ao lado, o texto rico da página aberta
 * (mesmo editor dos documentos do worldbuild). Anterior/próxima no rodapé.
 */
@Component({
  selector: 'app-sheet-notes',
  imports: [MatIconModule, MatTooltipModule, RichTextEditor],
  templateUrl: './sheet-notes.html',
  host: { class: 'flex h-full min-h-[420px] flex-col gap-3 @xl:flex-row' },
})
export class SheetNotes {
  private readonly session = inject(TableSessionService);

  readonly entryId = input.required<string>();

  readonly pages = computed(() => {
    const entry = this.session.entryById().get(this.entryId());
    return entry ? this.session.sheetOf(entry).notes : [];
  });

  /** Página aberta (padrão: a primeira). */
  private readonly currentId = signal<string | null>(null);
  readonly index = computed(() => Math.max(0, this.pages().findIndex((p) => p.id === this.currentId())));
  readonly current = computed<NotePage | undefined>(() => this.pages()[this.index()]);
  /**
   * A página aberta numa lista de um item: o editor é recriado (track pelo id)
   * ao trocar de página, já que ele lê o conteúdo só ao ser criado.
   */
  readonly currentList = computed(() => {
    const page = this.current();
    return page ? [page] : [];
  });

  open(page: NotePage): void {
    this.currentId.set(page.id);
  }

  /** Anterior (-1) ou próxima (+1) página. */
  step(delta: number): void {
    const page = this.pages()[this.index() + delta];
    if (page) this.open(page);
  }

  addPage(): void {
    const page: NotePage = { id: newId(), title: `Página ${this.pages().length + 1}`, content: '' };
    this.save([...this.pages(), page]);
    this.open(page);
  }

  rename(page: NotePage, title: string): void {
    if (title.trim() && title.trim() !== page.title) this.patch(page.id, { title: title.trim() });
  }

  /** Exclui a página (a última nunca é excluída). */
  remove(page: NotePage): void {
    if (this.pages().length <= 1) return;
    const hasText = page.content.replace(/<[^>]*>/g, '').trim();
    if (hasText && !confirm(`Excluir a página "${page.title}"?`)) return;
    const index = this.pages().indexOf(page);
    const pages = this.pages().filter((p) => p.id !== page.id);
    this.save(pages);
    if (this.current()?.id === page.id) this.currentId.set(pages[Math.max(0, index - 1)].id);
  }

  saveContent(pageId: string, content: string): void {
    this.patch(pageId, { content });
  }

  private patch(id: string, patch: Partial<NotePage>): void {
    this.save(this.pages().map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  private save(notes: NotePage[]): void {
    this.session.updateSheet(this.entryId(), { notes });
  }
}
