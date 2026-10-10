import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Tag } from '../../../../core/models/tag.model';
import { WorldItem, raceTraitsOf } from '../../../../core/models/world-item.model';
import {
  CharacterRelation,
  CharacterSheet,
  CharacterStudy,
  CharacterTheme,
  CURRENCY,
  DEFAULT_ROLL,
  GOAL_STEPS,
  NPC_TOKEN_SHEET,
  RaceRef,
  RaceSlot,
  SHEET_MAX_LEVEL,
  TableEntry,
  ThemeTag,
  ThemeTagList,
  TokenBar,
  isDown,
  isStatusBar,
} from '../../../../core/models/table-session.model';
import { AuthService } from '../../../../core/services/auth.service';
import { newId } from '../../../../core/utils/id';
import { TagEditor } from '../../../../shared/components/tag-editor/tag-editor';
import { readableTextOn } from '../../../../shared/utils/color';
import { BlobUrlService } from '../../services/blob-url.service';
import { SheetStore } from '../../../../core/services/sheet-store';
import { TableSessionService } from '../../services/table-session.service';
import { LevelPips } from '../level-pips/level-pips';
import { WorldbuildService } from '../../../worldbuild/services/worldbuild.service';
import { equippedWindowId } from '../equipped-item-window/equipped-item-window';
import { formatRoll } from '../../utils/dice';
import { inventoryRow } from '../../utils/inventory';
import { applyRace, raceKey } from '../../utils/race';
import { SheetInventory, itemSources } from '../sheet-inventory/sheet-inventory';
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
 *   personagem), três Temas (tags de nível 1 a 6 e defeitos de -1 a -6) e, no
 *   personagem, os itens Equipados (clique abre o cartão numa janela).
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
  /** Texto legível sobre a cor de uma etiqueta (branco em cores escuras, como o preto). */
  readonly textOn = readableTextOn;
  private readonly auth = inject(AuthService);
  private readonly worldbuild = inject(WorldbuildService);

  /** Id da ficha no SheetStore. */
  readonly sheetId = input.required<string>();
  /** Força só leitura (ex.: jogador abrindo um NPC do bestiário pela aba Lore da mesa). */
  readonly readonly = input(false);
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
    if (this.readonly()) return false;
    const entry = this.entry();
    return !this.session || !entry || this.session.canEdit(entry);
  });
  /** O mestre configura controle e visibilidade do NPC (só na mesa). */
  readonly isGm = computed(() => !!this.session && !!this.entry() && this.session.role() === 'gm');
  /** Controle por jogador fica na ficha do NPC da mesa (vale para todos os tokens dele). */
  readonly controllerSettings = computed(() => this.isNpc() && this.isGm() && this.data()?.level !== 'npc-token');
  /** Visibilidade para os jogadores é de cada token. */
  readonly publicSettings = computed(() => this.isGm() && this.data()?.level === 'npc-token');
  /**
   * A ficha mora na mesa? (fichas do bestiário — WorldNpcStore — não, mesmo abertas numa janela da mesa:
   * as permissões da mesa não as conhecem; quem abre como jogador já recebe `readonly`.)
   */
  private readonly tableSheet = computed(() => !!this.session && (this.store as unknown) === this.session);

  /** O que a conta atual pode ver/editar nesta ficha (fora da mesa e no bestiário: tudo, salvo `readonly`). */
  readonly access = computed(() => {
    const full = { edit: true, sheet: true, inventory: true };
    const access = this.tableSheet() ? (this.session?.sheetAccess(this.sheetId()) ?? full) : full;
    return this.readonly() ? { ...access, edit: false } : access;
  });
  /** Token desta ficha (só fichas de token de NPC). */
  private readonly placement = computed(() => {
    const id = this.sheetId();
    return id.startsWith(NPC_TOKEN_SHEET) ? this.session?.placementById(id.slice(NPC_TOKEN_SHEET.length)) : undefined;
  });
  /** Ficha / inventário deste token visíveis para os jogadores (botões do mestre). */
  readonly sheetPublic = computed(() => !!this.placement()?.sheetPublic);
  readonly inventoryPublic = computed(() => !!this.placement()?.inventoryPublic);
  /** Token derrotado: o inventário fica aberto aos jogadores de qualquer forma. */
  readonly tokenDown = computed(() => this.data()?.level === 'npc-token' && isDown(this.data()?.bars ?? []));

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
    // Ações existem na mesa e nos NPCs do bestiário (onde moram as habilidades deles)
    if ((!data.entry || !this.session) && data.level !== 'world') ids = ids.filter((id) => id !== 'abilities');
    const access = this.access();
    if (!access.edit) ids = ids.filter((id) => (id === 'sheet' && access.sheet) || (id === 'inventory' && access.inventory));
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

  /** Deixa a ficha ou o inventário deste token visível (só leitura) para os jogadores, ou não. */
  togglePublic(part: 'sheet' | 'inventory'): void {
    const placement = this.placement();
    if (placement) this.session?.toggleTokenPublic(placement.id, part);
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

  // --- Raça e sub-raça (Raças do mundo) ------------------------------------

  readonly raceSlots: { id: RaceSlot; label: string }[] = [
    { id: 'race', label: 'Raça' },
    { id: 'subrace', label: 'Sub-raça' },
  ];

  /** Raças que podem ser escolhidas: as do mundo aberto (na mesa, o mundo dela). */
  readonly raceOptions = computed(() =>
    this.worldbuild
      .worldRaces()
      .map((item): { key: string; ref: RaceRef; item: WorldItem } => ({ key: raceKey({ id: item.id }), ref: { id: item.id }, item })),
  );

  /** Chave da raça escolhida no campo (vazia = nenhuma). */
  raceKeyOf(slot: RaceSlot): string {
    const sheet = this.sheet();
    return raceKey(slot === 'race' ? sheet?.raceRef : sheet?.subraceRef);
  }

  /** Nome salvo no campo que não corresponde a uma raça da lista (texto antigo ou raça excluída). */
  orphanRaceName(slot: RaceSlot): string {
    const name = this.sheet()?.[slot] ?? '';
    const key = this.raceKeyOf(slot);
    return name && !this.raceOptions().some((o) => o.key === key) ? name : '';
  }

  /** Escolhe (ou limpa, com chave vazia) a raça do campo: aplica etiquetas e modificadores, desfazendo os da anterior. */
  chooseRace(slot: RaceSlot, key: string): void {
    const sheet = this.sheet();
    const data = this.data();
    if (!sheet || !data) return;
    const option = this.raceOptions().find((o) => o.key === key);
    const choice = option ? { ref: option.ref, name: option.item.name, traits: raceTraitsOf(option.item), statusMods: option.item.statusMods } : null;
    const result = applyRace(sheet, data.bars, slot, choice);
    this.update(result.sheet);
    this.store.updateStatus(this.sheetId(), { bars: result.bars });
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

  /** Máximo das barras de status: na mesa, só o mestre edita à mão (fora da mesa, quem edita a ficha). */
  readonly canEditMax = computed(() => !this.session || this.session.canEditStatusMax());

  /** Valor/máximo digitado (ignora texto inválido). */
  setBarNumber(bar: TokenBar, field: 'value' | 'max', raw: string): void {
    if (field === 'max' && !this.canEditMax()) return;
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

  // --- Objetivo dos temas (personagem) -------------------------------------

  readonly goalSteps = GOAL_STEPS;

  /** Clicar no último marcador aceso desmarca ele (permite voltar a 0). */
  setGoalProgress(theme: CharacterTheme, value: number): void {
    this.updateTheme(theme.id, { goalProgress: value === theme.goalProgress ? value - 1 : value });
  }

  /** Marcadores vermelhos de abandono (chegam como -1…-5); clicar no último aceso desmarca ele. */
  setGoalAbandon(theme: CharacterTheme, signed: number): void {
    const value = Math.abs(signed);
    this.updateTheme(theme.id, { goalAbandon: value === theme.goalAbandon ? value - 1 : value });
  }

  // --- Estudos e Treinos (personagem) --------------------------------------

  /** O SN é definido pelo mestre (no papel de mestre, na mesa). */
  readonly gmRole = computed(() => this.session?.role() === 'gm');

  updateStudy(id: string, patch: Partial<CharacterStudy>): void {
    this.update({ studies: (this.sheet()?.studies ?? []).map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  }

  /** SA ou SN digitado (inteiro ≥ 0; texto inválido é ignorado; SN vazio = 0, sem definir). */
  setStudyNumber(id: string, field: 'sa' | 'sn', raw: string): void {
    const n = raw.trim() === '' ? 0 : Number(raw);
    if (Number.isFinite(n)) this.updateStudy(id, { [field]: Math.max(0, Math.round(n)) });
  }

  /** Avanço do estudo em % (SA de SN; sem SN = 0). */
  studyPercent(study: CharacterStudy): number {
    return study.sn > 0 ? Math.min(100, (study.sa / study.sn) * 100) : 0;
  }

  // --- Equipados (personagem) ----------------------------------------------

  /** Itens marcados como equipados no inventário (com a personalização da ficha). */
  readonly equipped = computed(() => {
    const sources = itemSources(this.worldbuild, this.session);
    return (this.sheet()?.inventory ?? []).filter((i) => i.equipped).map((i) => inventoryRow(i, sources));
  });

  /** Abre o cartão do item equipado numa janela. */
  openEquipped(inventoryId: string): void {
    this.openEntry.emit(equippedWindowId(this.sheetId(), inventoryId));
  }

  // --- Habilidades ---------------------------------------------------------
  // Na mesa: as ações da entrada dona da ficha (NPC-referência: as do NPC do mundo).
  // No bestiário: as habilidades guardadas no próprio NPC do mundo, editadas aqui mesmo.

  /** NPC do bestiário desta ficha (só fichas base abertas pelo Worldbuild/aba Lore). */
  private readonly worldNpc = computed(() => (this.data()?.level === 'world' ? this.worldbuild.byId().get(this.sheetId()) : undefined));
  /** Ficha do bestiário: habilidades editadas na própria ficha (sem janela de configuração). */
  readonly worldAbilities = computed(() => !!this.worldNpc());
  /** Texto de ajuda da aba conforme onde as habilidades moram. */
  readonly abilitiesHint = computed(() => {
    if (this.worldAbilities()) return 'Habilidades deste NPC, válidas em todas as mesas do mundo. Na mesa, elas ficam na barra de ações; lá também dá para escolher ícone, tags e efeito especial.';
    if (this.data()?.level === 'character') return 'Ações deste personagem, criadas pelo jogador ou pelo mestre. Também ficam na barra de ações (teclas 1–0). Ao configurar uma habilidade, ligue tags dos temas: o nível delas entra no modificador e acompanha a ficha.';
    if (this.entry()?.worldNpcId) return 'Habilidades deste NPC: ficam no NPC do mundo e valem em todas as mesas dele. Também aparecem na barra de ações (teclas 1–0).';
    return 'Ações deste NPC. Também ficam na barra de ações (teclas 1–0).';
  });

  /** Ações desta ficha. */
  readonly abilities = computed(() => {
    const npc = this.worldNpc();
    if (npc) return npc.abilities ?? [];
    const entry = this.entry();
    return entry && this.session ? this.session.automationsOf(entry.id) : [];
  });

  /** Cria uma habilidade (na mesa, já abre para configurar). */
  addAbility(): void {
    const npc = this.worldNpc();
    if (npc) {
      const ability: TableEntry = {
        id: newId(),
        kind: 'automation',
        name: `Habilidade ${this.abilities().length + 1}`,
        icon: 'bolt',
        roll: { ...DEFAULT_ROLL },
        createdAt: Date.now(),
      };
      this.worldbuild.update(npc.id, { abilities: [...(npc.abilities ?? []), ability] });
      return;
    }
    const entry = this.entry();
    if (!entry || !this.session) return;
    const created = this.session.addEntry('automation', { ownerEntryId: entry.id });
    this.openEntry.emit(created.id);
  }

  /** Bestiário: altera nome ou rolagem de uma habilidade do NPC do mundo. */
  updateWorldAbility(id: string, patch: Partial<Pick<TableEntry, 'name' | 'roll'>>): void {
    const npc = this.worldNpc();
    if (npc) this.worldbuild.update(npc.id, { abilities: (npc.abilities ?? []).map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  }

  /** Rolagem da habilidade (padrão: 2d12 + 0). */
  rollOf(action: TableEntry) {
    return action.roll ?? DEFAULT_ROLL;
  }

  /** Bestiário: rolagem da habilidade com um campo trocado (texto inválido no modificador é ignorado). */
  setWorldRoll(action: TableEntry, patch: { dice?: string; modifier?: string }): void {
    const roll = action.roll ?? DEFAULT_ROLL;
    const modifier = patch.modifier === undefined ? roll.modifier : Number(patch.modifier || 0);
    if (!Number.isFinite(modifier)) return;
    const dice = patch.dice === '3d6' ? '3d6' : patch.dice === '2d12' ? '2d12' : roll.dice;
    this.updateWorldAbility(action.id, { roll: { ...roll, dice, modifier: Math.round(modifier) } });
  }

  /** Bestiário: exclui a habilidade do NPC do mundo (some de todas as mesas). */
  removeWorldAbility(action: TableEntry): void {
    const npc = this.worldNpc();
    if (!npc || !confirm(`Excluir a habilidade "${action.name}"? Ela some do NPC em todas as mesas do mundo.`)) return;
    this.worldbuild.update(npc.id, { abilities: (npc.abilities ?? []).filter((a) => a.id !== action.id) });
  }

  /** Fórmula com o nível atual das tags ligadas à habilidade (as desta ficha). */
  formula(action: TableEntry): string {
    if (this.worldAbilities() || !this.session) return formatRoll(action.roll ?? DEFAULT_ROLL);
    return this.session.formulaOf(action, this.sheetId());
  }
}
