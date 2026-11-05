import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { firstValueFrom } from 'rxjs';
import { LibraryEntry, LibrarySection, LibraryService, parentOf } from '../../../core/services/library.service';

interface PickerData {
  section: LibrarySection;
  multiple: boolean;
}

/**
 * Escolher arquivos da biblioteca sem sair da mesa (só o dono). Devolve os arquivos como `File`: quem
 * usa os envia à mesa pelo caminho de sempre, e é essa cópia, sem metadados, que os jogadores recebem.
 */
@Component({
  selector: 'app-library-picker',
  imports: [MatButtonModule, MatDialogModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './library-picker.html',
})
export class LibraryPicker {
  readonly library = inject(LibraryService);
  readonly data = inject<PickerData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<LibraryPicker, File[]>);

  readonly folder = signal<string>(this.data.section);
  readonly search = signal('');
  readonly selected = signal<ReadonlySet<string>>(new Set());
  readonly busy = signal(false);
  readonly error = signal('');

  constructor() {
    void this.library.load().catch((e: unknown) => this.error.set(e instanceof Error ? e.message : 'Não foi possível abrir a biblioteca.'));
  }

  readonly visible = computed(() => {
    const term = this.search().trim().toLowerCase();
    const list = this.library.entries().filter((e) => e.section === this.data.section);
    const shown = term ? list.filter((e) => e.type === 'file' && e.name.toLowerCase().includes(term)) : list.filter((e) => parentOf(e.path) === this.folder());
    return shown.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'pt-BR', { numeric: true }) : a.type === 'folder' ? -1 : 1));
  });

  /** Sobe uma pasta (null = já está na principal). */
  readonly parent = computed(() => (this.folder() === this.data.section ? null : parentOf(this.folder())));

  fileUrl(entry: LibraryEntry): string {
    return this.library.fileUrl(entry.path);
  }

  /** Clique: abre a pasta; no arquivo, marca (vários) ou já usa (um só). */
  choose(entry: LibraryEntry): void {
    if (entry.type === 'folder') {
      this.folder.set(entry.path);
      this.search.set('');
      return;
    }
    if (!this.data.multiple) {
      void this.finish([entry]);
      return;
    }
    this.selected.update((set) => {
      const next = new Set(set);
      if (!next.delete(entry.path)) next.add(entry.path);
      return next;
    });
  }

  confirm(): void {
    const chosen = this.selected();
    void this.finish(this.library.entries().filter((e) => chosen.has(e.path)));
  }

  private async finish(entries: readonly LibraryEntry[]): Promise<void> {
    this.busy.set(true);
    try {
      this.dialogRef.close(await Promise.all(entries.map((e) => this.library.fetchFile(e))));
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Não foi possível ler o arquivo.');
      this.busy.set(false);
    }
  }

  /** Abre o seletor e devolve os arquivos escolhidos (vazio = cancelou). */
  static async pick(dialog: MatDialog, section: LibrarySection, multiple = false): Promise<File[]> {
    const ref = dialog.open<LibraryPicker, PickerData, File[]>(LibraryPicker, { data: { section, multiple }, width: '720px', maxWidth: '94vw' });
    return (await firstValueFrom(ref.afterClosed())) ?? [];
  }
}
