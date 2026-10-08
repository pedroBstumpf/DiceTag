import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Tag } from '../../../../core/models/tag.model';
import {
  CharacterRelation,
  CharacterSheet,
  CharacterTheme,
  DEFAULT_ROLL,
  SHEET_MAX_LEVEL,
  TableEntry,
  ThemeTag,
  ThemeTagList,
  TokenBar,
  isStatusBar,
} from '../../../../core/models/table-session.model';
import { AuthService } from '../../../../core/services/auth.service';
import { newId } from '../../../../core/utils/id';
import { TagEditor } from '../../../../shared/components/tag-editor/tag-editor';
import { BlobUrlService } from '../../services/blob-url.service';
import { TableSessionService } from '../../services/table-session.service';
import { formatRoll } from '../../utils/dice';
import { LevelPips } from '../level-pips/level-pips';
import { SheetInventory } from '../sheet-inventory/sheet-inventory';
import { SheetNotes } from '../sheet-notes/sheet-notes';

/** Abas da ficha de personagem. */
type SheetTab = 'sheet' | 'inventory' | 'notes' | 'abilities';

/**
 * Ficha do personagem jogador, com abas:
 * - Ficha: cards Básico (imagem, nome, raça, sub-raça, rótulos), Status (barras
 *   Corpo/Mente/Espírito e etiquetas — as mesmas do token no mapa), Relações e três Temas
 *   (tags de nível 1 a 6 e defeitos de -1 a -6).
 * - Inventário: itens do mundo que o personagem possui, com o cartão ao lado (SheetInventory).
 * - Anotações: caderno de texto rico em páginas (SheetNotes).
 * - Habilidades: as ações (automações) do personagem, criadas por ele ou pelo mestre.
 * Tudo é gravado na ficha (`TableEntry.sheet`) ou no token dela (barras e etiquetas).
 */
@Component({
  selector: 'app-character-sheet',
  imports: [NgTemplateOutlet, MatIconModule, MatTooltipModule, TagEditor, LevelPips, SheetInventory, SheetNotes],
  templateUrl: './character-sheet.html',
  host: { class: 'flex h-full flex-col' },
})
export class CharacterSheetView {
  readonly session = inject(TableSessionService);
  readonly blobs = inject(BlobUrlService);
  private readonly auth = inject(AuthService);

  readonly entryId = input.required<string>();
  /** Pedido para abrir outra ficha/ação numa janela. */
  readonly openEntry = output<string>();
  /** Uma habilidade foi usada pela ficha. */
  readonly used = output<TableEntry>();

  // --- Abas ----------------------------------------------------------------
  readonly tabs: { id: SheetTab; icon: string; label: string }[] = [
    { id: 'sheet', icon: 'badge', label: 'Ficha' },
    { id: 'inventory', icon: 'backpack', label: 'Inventário' },
    { id: 'notes', icon: 'edit_note', label: 'Anotações' },
    { id: 'abilities', icon: 'bolt', label: 'Habilidades' },
  ];
  readonly tab = signal<SheetTab>('sheet');

  // --- Dados ---------------------------------------------------------------
  readonly entry = computed(() => this.session.entryById().get(this.entryId()));
  readonly sheet = computed(() => {
    const entry = this.entry();
    return entry ? this.session.sheetOf(entry) : null;
  });
  private readonly token = computed(() => {
    const entry = this.entry();
    return entry ? this.session.tokenOf(entry) : null;
  });
  /** Barras Corpo, Mente e Espírito (ficam no token da ficha). */
  readonly statusBars = computed(() => (this.token()?.bars ?? []).filter(isStatusBar));
  /** Etiquetas do personagem (as mesmas exibidas abaixo do token). */
  readonly tags = computed(() => this.token()?.tags ?? []);
  /** Quantidade de itens no inventário (contador da aba). */
  readonly inventoryCount = computed(() => this.sheet()?.inventory.length ?? 0);
  /** O personagem é da conta atual? */
  readonly isMine = computed(() => this.entry()?.ownerUserId === this.auth.user()?.id);

  readonly maxLevel = SHEET_MAX_LEVEL;

  // --- Básico --------------------------------------------------------------

  rename(value: string): void {
    if (value.trim()) this.session.updateEntry(this.entryId(), { name: value.trim() });
  }

  /** Envia (ou troca) a imagem da ficha — é a mesma do token, em todos os mapas. */
  async onImagePicked(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (file?.type.startsWith('image/')) await this.session.setTokenImage(this.entryId(), file);
  }

  claim(): void {
    this.session.updateEntry(this.entryId(), { ownerUserId: this.auth.user()?.id });
  }

  update(patch: Partial<CharacterSheet>): void {
    this.session.updateSheet(this.entryId(), patch);
  }

  /** Adiciona o rótulo digitado (ignora vazio e repetido) e limpa o campo. */
  addLabel(input: HTMLInputElement): void {
    const label = input.value.trim();
    input.value = '';
    const labels = this.sheet()?.labels ?? [];
    if (label && !labels.includes(label)) this.update({ labels: [...labels, label] });
  }

  removeLabel(label: string): void {
    this.update({ labels: (this.sheet()?.labels ?? []).filter((l) => l !== label) });
  }

  // --- Status --------------------------------------------------------------

  /** Botões −/+ da barra (entre 0 e o máximo). */
  stepBar(bar: TokenBar, delta: number): void {
    this.patchBar(bar.id, { value: Math.min(bar.max, Math.max(0, bar.value + delta)) });
  }

  /** Valor/máximo digitado (ignora texto inválido). */
  setBarNumber(bar: TokenBar, field: 'value' | 'max', raw: string): void {
    const n = Number(raw);
    if (raw !== '' && Number.isFinite(n)) this.patchBar(bar.id, { [field]: Math.max(0, Math.round(n)) });
  }

  /** Preenchimento da barra em % (0–100). */
  percent(bar: TokenBar): number {
    return bar.max > 0 ? Math.min(100, Math.max(0, (bar.value / bar.max) * 100)) : 0;
  }

  setTags(tags: Tag[]): void {
    this.session.updateEntryToken(this.entryId(), { tags });
  }

  private patchBar(id: string, patch: Partial<TokenBar>): void {
    const bars = this.token()?.bars ?? [];
    this.session.updateEntryToken(this.entryId(), { bars: bars.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
  }

  // --- Relações ------------------------------------------------------------

  addRelation(): void {
    const relation: CharacterRelation = { id: newId(), name: '', level: 1, description: '' };
    this.update({ relations: [...(this.sheet()?.relations ?? []), relation] });
  }

  updateRelation(id: string, patch: Partial<CharacterRelation>): void {
    this.update({ relations: (this.sheet()?.relations ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  }

  removeRelation(id: string): void {
    this.update({ relations: (this.sheet()?.relations ?? []).filter((r) => r.id !== id) });
  }

  // --- Temas ---------------------------------------------------------------

  updateTheme(id: string, patch: Partial<CharacterTheme>): void {
    this.update({ themes: (this.sheet()?.themes ?? []).map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  }

  /** Tags positivas ou defeitos do tema (tipado para o template). */
  tagsOf(theme: CharacterTheme, list: ThemeTagList): ThemeTag[] {
    return theme[list];
  }

  /** Nova tag (nível 1) ou novo defeito (nível -1). */
  addThemeTag(theme: CharacterTheme, list: ThemeTagList): void {
    const tag: ThemeTag = { id: newId(), text: '', level: list === 'flaws' ? -1 : 1 };
    this.updateTheme(theme.id, { [list]: [...theme[list], tag] });
  }

  updateThemeTag(theme: CharacterTheme, list: ThemeTagList, tagId: string, patch: Partial<ThemeTag>): void {
    this.updateTheme(theme.id, { [list]: theme[list].map((t) => (t.id === tagId ? { ...t, ...patch } : t)) });
  }

  removeThemeTag(theme: CharacterTheme, list: ThemeTagList, tagId: string): void {
    this.updateTheme(theme.id, { [list]: theme[list].filter((t) => t.id !== tagId) });
  }

  // --- Habilidades (ações do personagem) -----------------------------------

  /** Ações deste personagem (criadas pelo jogador ou pelo mestre). */
  readonly abilities = computed(() => this.session.automationsOf(this.entryId()));

  /** Cria uma habilidade do personagem e a abre para configurar. */
  addAbility(): void {
    const created = this.session.addEntry('automation', { ownerEntryId: this.entryId() });
    this.openEntry.emit(created.id);
  }

  formula(entry: TableEntry): string {
    return formatRoll(entry.roll ?? DEFAULT_ROLL);
  }
}
