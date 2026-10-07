import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { WORLD_ITEM_META, WorldItem } from '../../../../core/models/world-item.model';
import { TABLE_ENTRY_META, TableEntry, TableEntryKind, TableRole } from '../../../../core/models/table-session.model';
import { AutoFocus } from '../../../../shared/directives/auto-focus.directive';
import { WorldbuildService } from '../../../worldbuild/services/worldbuild.service';
import { TableSessionService } from '../../services/table-session.service';

/** Abas do painel lateral direito. */
type PanelTab = 'sheets' | 'lore' | 'sounds' | 'automations';

/**
 * Painel lateral direito da mesa, com abas:
 * - Fichas: personagens e NPCs
 * - Lore: documentos, linhas do tempo e mapas do worldbuild
 * - Sons: trilhas e ambientação
 * - Automações: habilidades e ações (do mestre e dos jogadores)
 * Cada arquivo abre numa janela flutuante.
 */
@Component({
  selector: 'app-side-panel',
  imports: [NgTemplateOutlet, RouterLink, MatButtonModule, MatIconModule, MatTooltipModule, AutoFocus],
  templateUrl: './side-panel.html',
  host: { class: 'flex h-full flex-col' },
})
export class SidePanel {
  readonly session = inject(TableSessionService);
  private readonly worldbuild = inject(WorldbuildService);

  readonly worldMeta = WORLD_ITEM_META;

  /** Pedido para abrir um arquivo (da mesa ou do worldbuild) numa janela. */
  readonly opened = output<string>();
  /** Arquivo excluído (para fechar a janela). */
  readonly removed = output<string>();

  // --- Abas ----------------------------------------------------------------
  readonly tabs: { id: PanelTab; icon: string; label: string }[] = [
    { id: 'sheets', icon: 'group', label: 'Fichas' },
    { id: 'lore', icon: 'menu_book', label: 'Lore' },
    { id: 'sounds', icon: 'graphic_eq', label: 'Sons' },
    { id: 'automations', icon: 'bolt', label: 'Automações' },
  ];
  readonly tab = signal<PanelTab>('sheets');
  readonly renamingId = signal<string | null>(null);
  readonly query = signal('');

  // --- Listas --------------------------------------------------------------
  readonly characters = computed(() => this.byKind('character'));
  readonly npcs = computed(() => this.byKind('npc'));
  readonly sounds = computed(() => this.byKind('sound'));
  readonly gmActions = computed(() => this.byKind('automation').filter((e) => e.role === 'gm'));
  readonly playerActions = computed(() => this.byKind('automation').filter((e) => e.role === 'player'));

  /** Itens do worldbuild (exceto pastas), filtrados pela busca. */
  readonly lore = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.worldbuild
      .items()
      .filter((i) => i.type !== 'folder' && (!q || i.name.toLowerCase().includes(q)))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  });

  // --- Ações ---------------------------------------------------------------

  create(kind: TableEntryKind, role?: TableRole): void {
    const entry = this.session.addEntry(kind, role ? { role } : {});
    this.renamingId.set(entry.id);
    this.opened.emit(entry.id);
  }

  async onSoundsPicked(input: HTMLInputElement): Promise<void> {
    for (const file of Array.from(input.files ?? [])) {
      if (file.type.startsWith('audio/')) await this.session.uploadSound(file);
    }
    input.value = '';
  }

  finishRename(entry: TableEntry, value: string): void {
    if (this.renamingId() !== entry.id) return;
    if (value.trim()) this.session.updateEntry(entry.id, { name: value.trim() });
    this.renamingId.set(null);
  }

  remove(entry: TableEntry): void {
    if (!confirm(`Excluir "${entry.name}"?`)) return;
    this.session.removeEntry(entry.id);
    this.removed.emit(entry.id);
  }

  /** Ícone/cor de um tipo de arquivo (tipado para os templates). */
  metaOf(kind: TableEntryKind) {
    return TABLE_ENTRY_META[kind];
  }

  loreMeta(item: WorldItem) {
    return WORLD_ITEM_META[item.type];
  }

  private byKind(kind: TableEntryKind): TableEntry[] {
    return this.session.entries().filter((e) => e.kind === kind);
  }
}
