import { Component, computed, inject, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  AUTOMATION_ICONS,
  DEFAULT_FX,
  DEFAULT_ROLL,
  DICE_KINDS,
  DiceKind,
  FxStyle,
  ROLL_OUTCOMES,
  RollConfig,
  RollOutcome,
  TABLE_ENTRY_META,
  TableEntry,
} from '../../../../core/models/table-session.model';
import { BlobUrlService } from '../../services/blob-url.service';
import { TableSessionService } from '../../services/table-session.service';
import { formatModifier } from '../../utils/dice';
import { FxPicker } from '../fx-picker/fx-picker';

/** Faixas de resultado de cada dado (legenda da configuração da rolagem). */
const OUTCOME_GUIDE: Record<DiceKind, { outcome: RollOutcome; range: string }[]> = {
  '2d12': [
    { outcome: 'critical-failure', range: '< 0' },
    { outcome: 'failure', range: '0–11' },
    { outcome: 'partial', range: '12–16' },
    { outcome: 'success', range: '17–23' },
    { outcome: 'critical-success', range: '24+' },
  ],
  '3d6': [
    { outcome: 'bad-luck', range: '≤ 9' },
    { outcome: 'neutral', range: '10–12' },
    { outcome: 'good-luck', range: '13+' },
  ],
};

/**
 * Janela de NPC ou automação aberta pelo painel (personagens usam a ficha
 * completa, `CharacterSheetView`).
 *
 * - NPC: nome, imagem (a mesma do token) e as ações automatizadas dele.
 *   O resto da ficha de NPC será estruturado depois.
 * - Automação: dono (personagem, NPC ou geral do mestre), ícone, rolagem
 *   (2d12 ou 3d6 + modificador) e efeito especial lançado ao usar.
 * As demais opções do token ficam só no mapa (duplo clique no token).
 */
@Component({
  selector: 'app-entry-window',
  imports: [MatIconModule, MatTooltipModule, FxPicker],
  templateUrl: './entry-window.html',
  host: { class: 'flex h-full flex-col overflow-y-auto p-6' },
})
export class EntryWindow {
  readonly session = inject(TableSessionService);
  readonly blobs = inject(BlobUrlService);

  readonly entryId = input.required<string>();
  /** Pedido para abrir outra ficha/ação numa janela. */
  readonly openEntry = output<string>();

  readonly entry = computed(() => this.session.entryById().get(this.entryId()));
  readonly meta = computed(() => TABLE_ENTRY_META[this.entry()?.kind ?? 'character']);
  /** Personagens e NPCs têm imagem (a mesma usada no token). */
  readonly hasToken = computed(() => this.entry()?.kind === 'character' || this.entry()?.kind === 'npc');
  readonly icons = AUTOMATION_ICONS;
  readonly diceKinds = DICE_KINDS;

  // --- NPC -----------------------------------------------------------------

  /** Ações automatizadas desta ficha. */
  readonly actions = computed(() => this.session.automationsOf(this.entryId()));

  /** Cria uma ação desta ficha e a abre. */
  addAction(): void {
    const created = this.session.addEntry('automation', { ownerEntryId: this.entryId() });
    this.openEntry.emit(created.id);
  }

  // --- Automação -----------------------------------------------------------

  /** Fichas que podem ser donas da ação (personagens e NPCs). */
  readonly owners = computed(() => this.session.entries().filter((e) => e.kind === 'character' || e.kind === 'npc'));

  readonly roll = computed<RollConfig>(() => this.entry()?.roll ?? DEFAULT_ROLL);
  readonly guide = computed(() => OUTCOME_GUIDE[this.roll().dice]);

  /** Trocar o dono desliga as tags do dono anterior. */
  setOwner(value: string): void {
    const { attributes: _, ...roll } = this.roll();
    this.session.updateEntry(this.entryId(), { ownerEntryId: value || undefined, roll });
  }

  // --- Tags do personagem no modificador -----------------------------------

  /** O dono da ação é um personagem (só personagens têm temas com tags). */
  readonly ownerIsCharacter = computed(() => {
    const ownerId = this.entry()?.ownerEntryId;
    return !!ownerId && this.session.entryById().get(ownerId)?.kind === 'character';
  });
  /** Tags e defeitos dos temas do dono. */
  readonly ownerTags = computed(() => this.session.themeTagsOf(this.entry()?.ownerEntryId));
  /** Tags ligadas a esta ação que ainda existem na ficha. */
  readonly linkedTags = computed(() => {
    const ids = new Set(this.roll().attributes ?? []);
    return this.ownerTags().filter((t) => ids.has(t.id));
  });
  /** Composição do modificador, ex.: "+1 fixo +3 Esgrima −2 Medo = +2". */
  readonly breakdown = computed(() => {
    const parts = [`${this.modifierText(this.roll().modifier)} fixo`, ...this.linkedTags().map((t) => `${this.modifierText(t.level)} ${t.text}`)];
    const total = this.linkedTags().reduce((sum, t) => sum + t.level, this.roll().modifier);
    return `${parts.join(' ')} = ${this.modifierText(total)}`;
  });

  isLinked(tagId: string): boolean {
    return (this.roll().attributes ?? []).includes(tagId);
  }

  /** Liga/desliga a tag (ids de tags apagadas da ficha são descartados aqui). */
  toggleTag(tagId: string): void {
    const valid = new Set(this.ownerTags().map((t) => t.id));
    const current = (this.roll().attributes ?? []).filter((id) => valid.has(id));
    const attributes = current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId];
    this.patchRoll({ attributes: attributes.length ? attributes : undefined });
  }

  tagClass(flaw: boolean, on: boolean): string {
    if (!on) return 'bg-white/5 text-slate-400 ring-1 ring-white/10 hover:bg-white/10 hover:text-slate-200';
    return flaw ? 'bg-red-500/15 text-red-200 ring-1 ring-red-400/50' : 'bg-astral-500/20 text-astral-200 ring-1 ring-astral-400/50';
  }

  setDice(dice: DiceKind): void {
    this.patchRoll({ dice });
  }

  stepModifier(delta: number): void {
    this.patchRoll({ modifier: this.roll().modifier + delta });
  }

  /** Modificador digitado (ignora texto inválido; arredonda para inteiro). */
  setModifier(raw: string): void {
    const n = Number(raw);
    if (raw.trim() !== '' && raw.trim() !== '-' && Number.isFinite(n)) this.patchRoll({ modifier: Math.round(n) });
  }

  toggleEffect(): void {
    this.session.updateEntry(this.entryId(), { effect: this.entry()?.effect ? undefined : { ...DEFAULT_FX } });
  }

  setEffect(effect: FxStyle): void {
    this.session.updateEntry(this.entryId(), { effect });
  }

  private patchRoll(patch: Partial<RollConfig>): void {
    this.session.updateEntry(this.entryId(), { roll: { ...this.roll(), ...patch } });
  }

  // --- Comum ---------------------------------------------------------------

  rename(value: string): void {
    if (value.trim()) this.session.updateEntry(this.entryId(), { name: value.trim() });
  }

  /** Envia (ou troca) a imagem da ficha — é a mesma do token, em todos os mapas. */
  async onImagePicked(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (file?.type.startsWith('image/')) await this.session.setTokenImage(this.entryId(), file);
  }

  /** Subtítulo da automação: papel derivado do dono. */
  ownerLabel(entry: TableEntry): string {
    const owner = entry.ownerEntryId ? this.session.entryById().get(entry.ownerEntryId) : undefined;
    if (!owner) return 'Mestre · geral';
    return owner.kind === 'character' ? `Jogador · ${owner.name}` : `Mestre · ${owner.name}`;
  }

  outcomeOf(outcome: RollOutcome) {
    return ROLL_OUTCOMES[outcome];
  }

  /** Fórmula com o modificador efetivo (fixo + tags do personagem). */
  formula(entry: TableEntry): string {
    return this.session.formulaOf(entry);
  }

  modifierText(modifier: number): string {
    return formatModifier(modifier) || '±0';
  }
}
