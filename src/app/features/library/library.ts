import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { HostService } from '../../core/services/host.service';
import { LibraryEntry, LibrarySection, LibraryService, parentOf, sectionOf } from '../../core/services/library.service';
import { AutoFocus } from '../../shared/directives/auto-focus.directive';
import { EmptyState } from '../../shared/components/empty-state/empty-state';

/** Aba da página. */
const SECTIONS: { id: LibrarySection; label: string; icon: string; empty: string }[] = [
  { id: 'imagens', label: 'Imagens', icon: 'image', empty: 'mapas, retratos e itens' },
  { id: 'sons', label: 'Sons', icon: 'graphic_eq', empty: 'músicas e ambientes' },
];

/** Arquivo arrastado para a página, com a pasta dele dentro do que foi solto. */
interface DroppedFile {
  file: File;
  subfolder: string;
}

/**
 * Página "Arquivos" (só o dono do app): imagens e sons, em pastas, numa pasta real do computador.
 * Enviar é copiar o arquivo para lá; colocar direto pelo Explorador do Windows também funciona, e a
 * lista sempre mostra o que está no disco. O servidor só enxerga esta pasta (ver `LibraryService`
 * no servidor), e os jogadores nunca recebem estes arquivos: usar um deles na mesa envia uma cópia
 * à mesa, sem os metadados.
 */
@Component({
  selector: 'app-library',
  imports: [DecimalPipe, MatButtonModule, MatIconModule, MatMenuModule, MatProgressSpinnerModule, MatTooltipModule, AutoFocus, EmptyState],
  templateUrl: './library.html',
})
export class Library {
  readonly library = inject(LibraryService);
  readonly host = inject(HostService);
  private readonly snackBar = inject(MatSnackBar);

  readonly sections = SECTIONS;
  readonly section = signal<LibrarySection>('imagens');
  /** Pasta aberta (`imagens`, `imagens/mapas`…). */
  readonly folder = signal<string>('imagens');
  readonly search = signal('');
  readonly creating = signal(false);
  readonly renaming = signal<string | null>(null);
  readonly dragOver = signal(false);
  /** Som tocando na pré-visualização. */
  readonly playing = signal<string | null>(null);
  /** Item sendo arrastado para outra pasta. */
  private draggedPath: string | null = null;

  constructor() {
    void this.reload();
    void this.host.refresh().catch(() => undefined);
  }

  // --- Lista -----------------------------------------------------------------

  /** Trechos da pasta aberta, para a navegação no topo. */
  readonly crumbs = computed(() => {
    const parts = this.folder().split('/');
    return parts.map((name, i) => ({ name: i === 0 ? SECTIONS.find((s) => s.id === name)?.label ?? name : name, path: parts.slice(0, i + 1).join('/') }));
  });

  /** O que aparece: o conteúdo da pasta ou, com busca, tudo o que combina na seção. */
  readonly visible = computed(() => {
    const term = normalize(this.search());
    const list = this.library.entries().filter((e) => e.section === this.section());
    const shown = term ? list.filter((e) => normalize(e.name).includes(term)) : list.filter((e) => parentOf(e.path) === this.folder());
    return shown.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'pt-BR', { numeric: true }) : a.type === 'folder' ? -1 : 1));
  });

  /** Quantos arquivos há em cada seção. */
  countOf(section: LibrarySection): number {
    return this.library.entries().filter((e) => e.section === section && e.type === 'file').length;
  }

  /** Total de bytes em uso na seção aberta. */
  readonly usedBytes = computed(() => this.library.entries().reduce((sum, e) => (e.section === this.section() ? sum + e.size : sum), 0));

  openSection(section: LibrarySection): void {
    this.section.set(section);
    this.folder.set(section);
    this.search.set('');
    this.playing.set(null);
  }

  openFolder(path: string): void {
    this.folder.set(path);
    this.search.set('');
  }

  // --- Ações -----------------------------------------------------------------

  private async reload(): Promise<void> {
    await this.run(() => this.library.load());
  }

  async createFolder(name: string): Promise<void> {
    this.creating.set(false);
    const trimmed = name.trim();
    if (trimmed) await this.run(() => this.library.createFolder(`${this.folder()}/${trimmed}`));
  }

  async rename(entry: LibraryEntry, name: string): Promise<void> {
    if (this.renaming() !== entry.path) return;
    this.renaming.set(null);
    const trimmed = name.trim();
    if (!trimmed || trimmed === entry.name) return;
    // Arquivo mantém a extensão, mesmo se a pessoa digitar só o nome
    const extension = entry.type === 'file' ? entry.name.slice(entry.name.lastIndexOf('.')) : '';
    const finalName = extension && !trimmed.toLowerCase().endsWith(extension.toLowerCase()) ? trimmed + extension : trimmed;
    await this.run(() => this.library.move(entry.path, `${parentOf(entry.path)}/${finalName}`));
  }

  async remove(entry: LibraryEntry): Promise<void> {
    const what = entry.type === 'folder' ? `a pasta "${entry.name}" e tudo o que há nela` : `"${entry.name}"`;
    if (!confirm(`Apagar ${what} do seu computador? Esta ação não pode ser desfeita. O que já foi usado nas mesas continua nelas.`)) return;
    await this.run(() => this.library.remove(entry.path));
  }

  async openInExplorer(): Promise<void> {
    await this.run(() => this.host.openFolder());
  }

  /** Abre a pasta (duplo clique) ou o nome (para renomear). */
  nameWithoutExtension(entry: LibraryEntry): string {
    return entry.type === 'file' ? entry.name.slice(0, entry.name.lastIndexOf('.')) : entry.name;
  }

  fileUrl(entry: LibraryEntry): string {
    return this.library.fileUrl(entry.path);
  }

  // --- Mover arrastando ---------------------------------------------------------

  onItemDragStart(entry: LibraryEntry, event: DragEvent): void {
    this.draggedPath = entry.path;
    event.dataTransfer?.setData('text/plain', entry.name);
  }

  /** Solta um item dentro de uma pasta da lista ou do caminho do topo. */
  async dropOnFolder(target: string, event: DragEvent): Promise<void> {
    const dragged = this.draggedPath;
    if (!dragged) return;
    event.preventDefault();
    event.stopPropagation();
    this.draggedPath = null;
    const name = dragged.slice(dragged.lastIndexOf('/') + 1);
    if (parentOf(dragged) !== target && target !== dragged) await this.run(() => this.library.move(dragged, `${target}/${name}`));
  }

  allowDrop(event: DragEvent): void {
    if (this.draggedPath) event.preventDefault();
  }

  // --- Enviar ------------------------------------------------------------------

  async onPicked(input: HTMLInputElement): Promise<void> {
    const files = Array.from(input.files ?? []).map((file) => ({ file, subfolder: '' }));
    input.value = '';
    await this.send(files);
  }

  onDragOver(event: DragEvent): void {
    if (this.draggedPath || !event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    this.dragOver.set(true);
  }

  async onDrop(event: DragEvent): Promise<void> {
    if (this.draggedPath || !event.dataTransfer?.items.length) return;
    event.preventDefault();
    this.dragOver.set(false);
    // Lido antes de qualquer espera: os itens do arraste só valem durante o próprio evento
    const roots = Array.from(event.dataTransfer.items).flatMap((item) => item.webkitGetAsEntry() ?? []);
    await this.send((await Promise.all(roots.map((root) => readEntry(root, '')))).flat());
  }

  /**
   * Envia os arquivos: cada um na pasta aberta, se for do tipo dela; senão, na seção certa. Pastas
   * soltas na página mantêm a organização, e o que não é imagem nem áudio é deixado de fora.
   */
  private async send(dropped: readonly DroppedFile[]): Promise<void> {
    const accepted = dropped.flatMap((d) => (sectionOf(d.file) ? [{ ...d, section: sectionOf(d.file)! }] : []));
    const skipped = dropped.length - accepted.length;
    if (!accepted.length) {
      if (skipped) this.snackBar.open('Só imagens e áudios são aceitos.');
      return;
    }
    const jobs = accepted.map(({ file, subfolder, section }) => {
      const base = section === this.section() ? this.folder() : section;
      return { file, folder: subfolder ? `${base}/${subfolder}` : base, section };
    });
    // As pastas que vieram do arraste precisam existir antes dos arquivos
    const folders = [...new Set(jobs.map((j) => j.folder))];
    const known = new Set(this.library.entries().map((e) => e.path));
    for (const folder of folders) {
      if (!known.has(folder) && folder !== 'imagens' && folder !== 'sons') await this.library.createFolder(folder).catch(() => undefined);
    }
    const failed = await this.library.upload(jobs);
    const sent = jobs.length - failed.length;
    const notes = [`${sent} ${sent === 1 ? 'arquivo enviado' : 'arquivos enviados'}`];
    if (failed.length) notes.push(`${failed.length} recusado(s): ${failed[0].name} (${failed[0].reason})`);
    if (skipped) notes.push(`${skipped} de outro tipo ficaram de fora`);
    this.snackBar.open(`${notes.join('; ')}.`, 'OK', { duration: failed.length ? 10_000 : 4000 });
    // Enviou algo de outro tipo: mostra onde foi parar
    if (!jobs.some((j) => j.section === this.section())) this.openSection(jobs[0].section);
  }

  // --- Internos ------------------------------------------------------------

  private async run(call: () => Promise<unknown>): Promise<void> {
    try {
      await call();
    } catch (e) {
      this.snackBar.open(e instanceof Error ? e.message : 'Algo deu errado.', undefined, { duration: 5000 });
    }
  }
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

/** Lê um arquivo ou, de uma pasta solta na página, tudo o que há nela, guardando as subpastas. */
async function readEntry(entry: FileSystemEntry, parent: string): Promise<DroppedFile[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    return [{ file, subfolder: parent }];
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const path = parent ? `${parent}/${entry.name}` : entry.name;
  const items: FileSystemEntry[] = [];
  // O navegador entrega os itens de uma pasta em lotes, até vir um lote vazio
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) break;
    items.push(...batch);
  }
  return (await Promise.all(items.map((item) => readEntry(item, path)))).flat();
}
