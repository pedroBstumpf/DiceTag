import { DatePipe } from '@angular/common';
import { Component, inject, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { BrowserCopyService, CopyImportResult } from '../../../core/services/browser-copy.service';
import { OnlineTablesService } from '../../../core/services/online-tables.service';
import { ServerAccountService } from '../../../core/services/server-account.service';
import { ServerWorldsService } from '../../../core/services/server-worlds.service';
import { BrowserCopy, COPY_EXTENSION, CopyContents, CopyWorld, copyContents, readCopy } from '../../../core/utils/browser-copy';

/**
 * Traz para o servidor uma cópia salva em "Neste navegador" (dono): mostra o que há nela, deixa
 * escolher e envia. Mundo ou mesa que parece já estar no servidor vem desmarcado: reenviar um mundo
 * substitui itens de mesmo id, e reenviar uma mesa cria outra igual.
 */
@Component({
  selector: 'app-copy-import',
  imports: [DatePipe, MatButtonModule, MatIconModule],
  templateUrl: './copy-import.html',
})
export class CopyImport {
  private readonly copies = inject(BrowserCopyService);
  private readonly account = inject(ServerAccountService);
  private readonly online = inject(OnlineTablesService);
  private readonly serverWorlds = inject(ServerWorldsService);

  readonly accept = COPY_EXTENSION;
  readonly progress = this.copies.progress;
  /** A importação terminou: a lista de mesas já foi atualizada. */
  readonly imported = output<void>();

  readonly copy = signal<BrowserCopy | null>(null);
  readonly contents = signal<CopyContents | null>(null);
  readonly pickedWorlds = signal<ReadonlySet<string>>(new Set());
  readonly pickedTables = signal<ReadonlySet<string>>(new Set());
  /** Mundos que já têm conteúdo no servidor: aviso ao lado do nome. */
  readonly existingWorlds = signal<ReadonlySet<string>>(new Set());
  readonly existingTables = signal<ReadonlySet<string>>(new Set());
  readonly working = signal(false);
  readonly error = signal('');
  readonly result = signal<CopyImportResult | null>(null);

  // --- Escolher o arquivo ----------------------------------------------------------------------

  async open(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.reset();
    this.working.set(true);
    try {
      const copy = await readCopy(file);
      const contents = copyContents(copy.data);
      const [worlds] = await Promise.all([this.copies.serverWorlds(), this.copies.load(() => this.online.load())]);
      const existingWorlds = new Set(contents.worlds.filter((w) => worlds.some((s) => s.name === w.name && s.items > 0)).map((w) => w.key));
      const names = new Set(this.online.tables().map((t) => t.name));
      const existingTables = new Set(contents.tables.filter((t) => names.has(t.table.name)).map((t) => t.table.id));
      this.existingWorlds.set(existingWorlds);
      this.existingTables.set(existingTables);
      this.pickedWorlds.set(new Set(contents.worlds.filter((w) => w.items.length && !existingWorlds.has(w.key)).map((w) => w.key)));
      this.pickedTables.set(new Set(contents.tables.filter((t) => !existingTables.has(t.table.id)).map((t) => t.table.id)));
      this.copy.set(copy);
      this.contents.set(contents);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Não foi possível abrir o arquivo.');
    } finally {
      this.progress.set('');
      this.working.set(false);
    }
  }

  // --- Escolher o que trazer -------------------------------------------------------------------

  toggleWorld(key: string): void {
    this.pickedWorlds.update((set) => toggled(set, key));
  }

  toggleTable(id: string): void {
    this.pickedTables.update((set) => toggled(set, id));
  }

  nothingPicked(): boolean {
    return !this.pickedWorlds().size && !this.pickedTables().size;
  }

  worldNameOf(key: string, worlds: CopyWorld[]): string {
    return worlds.find((w) => w.key === key)?.name ?? '';
  }

  // --- Importar --------------------------------------------------------------------------------

  async run(): Promise<void> {
    const copy = this.copy();
    const contents = this.contents();
    const owner = this.account.user();
    if (!copy || !contents || !owner) return;
    this.working.set(true);
    this.error.set('');
    try {
      const done = await this.copies.importCopy(copy, contents, { worlds: this.pickedWorlds(), tables: this.pickedTables() }, owner.id);
      this.copy.set(null);
      this.contents.set(null);
      this.result.set(done);
      this.imported.emit();
      // Já importou: se a lista não recarregar agora, isso não é uma falha da importação
      await this.copies.load(() => this.online.load()).catch(() => undefined);
      await this.serverWorlds.load();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Não foi possível importar.');
    } finally {
      this.working.set(false);
    }
  }

  reset(): void {
    this.copy.set(null);
    this.contents.set(null);
    this.result.set(null);
    this.error.set('');
  }
}

function toggled(set: ReadonlySet<string>, value: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(value)) next.add(value);
  return next;
}
