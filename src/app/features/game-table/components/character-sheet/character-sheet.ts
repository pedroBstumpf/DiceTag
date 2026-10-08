import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Tag } from '../../../../core/models/tag.model';
import {
  CharacterRelation,
  CharacterSheet,
  CharacterTheme,
  CURRENCY,
  NPC_TOKEN_SHEET,
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
import { SheetStore } from '../../../../core/services/sheet-store';
import { TableSessionService } from '../../services/table-session.service';
import { LevelPips } from '../level-pips/level-pips';
import { SheetInventory } from '../sheet-inventory/sheet-inventory';
import { SheetNotes } from '../sheet-notes/sheet-notes';

/** Abas da ficha. */
type SheetTab = 'sheet' | 'inventory' | 'notes' | 'abilities';

const TAB_META: Record<SheetTab, { icon: string; label: string }> = {
  sheet: { icon: 'badge', label: 'Ficha' },
  inventory: { icon: 'backpack', label: 'Inventário' },
  notes: { icon: 'edit_note', label: 'Anotações' },
  abilities: { icon: 'bolt', label: 'Habilidades' },
};

/**
 * Ficha de personagem jogador ou de NPC, com abas:
 * - Ficha: cards Básico (imagem, nome, raça, sub-raça, rótulos), Status (barras
 *   Corpo/Mente/Espírito e etiquetas — as mesmas do token no mapa), Relações (só
 *   personagem) e três Temas (tags de nível 1 a 6 e defeitos de -1 a -6).
 * - Inventário: itens do mundo que a ficha possui, com o cartão ao lado (SheetInventory).
 * - Anotações (só personagem): caderno de texto rico em páginas (SheetNotes).
 * - Habilidades (só na mesa): as ações (automações) da ficha.
 *
 * Lê e grava pelo `SheetStore` fornecido por quem exibe (a mesa ou o Worldbuild), pelo
 * id da ficha: personagem, NPC da mesa (a ficha base, se vier do bestiário), token de
 * NPC ("npc:<id>", cópia individual) ou NPC do bestiário. Recursos da mesa (ações, permissões, controle, visibilidade, Eiros) só
 * aparecem quando a ficha pertence a uma entrada da mesa (`SheetData.entry`).
 */
@Component({
  selector: 'app-character-sheet',
  imports: [NgTemplateOutlet, MatIconModule, MatTooltipModule, TagEditor, LevelPips, SheetInventory, SheetNotes],
  templateUrl: './character-sheet.html',
  host: { class: 'flex h-full flex-col' },
})
export class CharacterSheetView {
  readonly store = inject(SheetStore);
  /** Presente só na mesa. */
  readonly session = inject(TableSessionService, { optional: true });
  readonly blobs = inject(BlobUrlService);
  private readonly auth = inject(AuthService);

  /** Id da ficha no SheetStore. */
  readonly sheetId = input.required<string>();
  /** Pedido para abrir outra ficha/ação/item numa janela. */
  readonly openEntry = output<string>();
  /** Uma habilidade foi usada pela ficha. */
  readonly used = output<TableEntry>();

  // --- Dados ---------------------------------------------------------------
  readonly data = computed(() => this.store.sheetData(this.sheetId()));
  /** Entrada da mesa (ausente no Worldbuild). */
  readonly entry = computed(() => this.data()?.entry);
  readonly sheet = computed(() => this.data()?.sheet ?? null);
  /** Ficha de NPC (sem Relações nem Anotações). */
  readonly isNpc = computed(() => this.data()?.kind === 'npc');

  // --- Permissões ----------------------------------------------------------

  /** Pode editar (fora da mesa: sempre; na mesa: mestre e, no NPC, o jogador autorizado). */
  readonly canEdit = computed(() => {
    const entry = this.entry();
    return !this.session || !entry || this.session.canEdit(entry);
  });
  /** O mestre configura controle e visibilidade do NPC (só na mesa). */
  readonly isGm = computed(() => !!this.session && !!this.entry() && this.session.role() === 'gm');
  /** Controle e visibilidade ficam na ficha do NPC da mesa (valem para todos os tokens dele). */
  readonly npcSettings = computed(() => this.isNpc() && this.isGm() && this.data()?.level !== 'npc-token');

  /** Texto sob o card de Status, conforme onde a ficha mora. */
  readonly statusHint = computed(() => {
    switch (this.data()?.level) {
      case 'character':
        return 'Barras e etiquetas também aparecem no token do personagem.';
      case 'npc-token':
        return 'Barras e etiquetas deste token (as mesmas exibidas no mapa).';
      default:
        return 'Barras e etiquetas são o padrão dos próximos tokens deste NPC (cada token tem os seus no mapa).';
    }
  });

  // --- Abas ----------------------------------------------------------------

  /** Abas desta ficha que a conta atual pode ver (NPC público: só Ficha e/ou Inventário). */
  readonly tabs = computed(() => {
    const data = this.data();
    if (!data) return [];
    let ids: SheetTab[] = this.isNpc() ? ['sheet', 'inventory', 'abilities'] : ['sheet', 'inventory', 'notes', 'abilities'];
    // Ações só existem na mesa
    if (!data.entry || !this.session) ids = ids.filter((id) => id !== 'abilities');
    const entry = data.entry;
    if (entry && !this.canEdit()) {
      ids = ids.filter((id) => (id === 'sheet' && entry.sheetPublic) || (id === 'inventory' && entry.inventoryPublic));
    }
    return ids.map((id) => ({ id, ...TAB_META[id] }));
  });
  private readonly chosenTab = signal<SheetTab>('sheet');
  /** Aba aberta (volta para a primeira se a escolhida não existir ou não estiver liberada). */
  readonly tab = computed<SheetTab | null>(() => {
    const tabs = this.tabs();
    return tabs.find((t) => t.id === this.chosenTab())?.id ?? tabs[0]?.id ?? null;
  });

  selectTab(tab: SheetTab): void {
    this.chosenTab.set(tab);
  }

  /** Id da janela "Token" (tamanho, visão…) do token desta ficha. */
  tokenWindowId(): string {
    return 'token:' + this.sheetId().slice(NPC_TOKEN_SHEET.length);
  }

  // --- NPC: controle e visibilidade (mestre) -------------------------------

  /** Jogadores da mesa que podem receber o controle do NPC. */
  readonly players = computed(() => this.session?.players() ?? []);

  /** Jogador autorizado a controlar o NPC ('' = só o mestre). */
  setController(userId: string): void {
    const entry = this.entry();
    if (entry) this.session?.updateEntry(entry.id, { controllerUserId: userId || undefined });
  }

  /** Deixa a ficha ou o inventário do NPC visível (só leitura) para os jogadores, ou não. */
  togglePublic(part: 'sheet' | 'inventory'): void {
    const entry = this.entry();
    if (!entry) return;
    if (part === 'sheet') this.session?.updateEntry(entry.id, { sheetPublic: !entry.sheetPublic || undefined });
    else this.session?.updateEntry(entry.id, { inventoryPublic: !entry.inventoryPublic || undefined });
  }

  /** Barras Corpo, Mente e Espírito (ficam no token da ficha). */
  readonly statusBars = computed(() => (this.data()?.bars ?? []).filter(isStatusBar));
  /** Etiquetas (as mesmas exibidas abaixo do token). */
  readonly tags = computed(() => this.data()?.tags ?? []);
  /** Quantidade de itens no inventário (contador da aba). */
  readonly inventoryCount = computed(() => this.sheet()?.inventory.length ?? 0);
  /** O personagem é da conta atual? */
  readonly isMine = computed(() => this.entry()?.ownerUserId === this.auth.user()?.id);

  readonly maxLevel = SHEET_MAX_LEVEL;

  // --- Básico --------------------------------------------------------------

  rename(value: string): void {
    this.store.renameSheet(this.sheetId(), value);
  }

  /** Envia (ou troca) a imagem da ficha — é a mesma do token. */
  async onImagePicked(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (file?.type.startsWith('image/')) await this.store.setSheetImage(this.sheetId(), file);
  }

  claim(): void {
    const entry = this.entry();
    if (entry) this.session?.updateEntry(entry.id, { ownerUserId: this.auth.user()?.id });
  }

  update(patch: Partial<CharacterSheet>): void {
    this.store.updateSheet(this.sheetId(), patch);
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

  // --- Eiros (moeda do personagem) -----------------------------------------

  readonly currency = CURRENCY;

  /** Eiros digitados (inteiro, nunca negativo; texto inválido é ignorado). */
  setEiros(raw: string): void {
    const n = Number(raw);
    if (raw.trim() !== '' && Number.isFinite(n)) this.update({ eiros: Math.max(0, Math.round(n)) });
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
    this.store.updateStatus(this.sheetId(), { tags });
  }

  private patchBar(id: string, patch: Partial<TokenBar>): void {
    const bars = this.data()?.bars ?? [];
    this.store.updateStatus(this.sheetId(), { bars: bars.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
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

  // --- Habilidades (ações da ficha, só na mesa) ----------------------------

  /** Ações da entrada dona desta ficha (criadas pelo jogador ou pelo mestre). */
  readonly abilities = computed(() => {
    const entry = this.entry();
    return entry && this.session ? this.session.automationsOf(entry.id) : [];
  });

  /** Cria uma habilidade e a abre para configurar. */
  addAbility(): void {
    const entry = this.entry();
    if (!entry || !this.session) return;
    const created = this.session.addEntry('automation', { ownerEntryId: entry.id });
    this.openEntry.emit(created.id);
  }

  /** Fórmula com o nível atual das tags ligadas à habilidade (as desta ficha). */
  formula(action: TableEntry): string {
    return this.session?.formulaOf(action, this.sheetId()) ?? '';
  }
}
