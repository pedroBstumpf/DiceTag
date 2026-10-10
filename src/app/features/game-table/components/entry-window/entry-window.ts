import { Component, computed, inject, input } from '@angular/core';
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
  hasSheet,
} from '../../../../core/models/table-session.model';
import { SheetTagOption, TableSessionService } from '../../services/table-session.service';
import { NEGATED_TAG_PREFIX, attributeSign, baseTagId, formatModifier, powerOf, rollUsesTags } from '../../utils/dice';
import { FxPicker } from '../fx-picker/fx-picker';

/** Faixas de resultado de cada dado (legenda da configuração da rolagem). */
const OUTCOME_GUIDE: Record<DiceKind, { outcome: RollOutcome; range: string }[]> = {
  '2d12': [
    { outcome: 'critical-failure', range: '< 0' },
    { outcome: 'failure', range: '0–11' },
    { outcome: 'partial', range: '12–17' },
    { outcome: 'success', range: '18–23' },
    { outcome: 'critical-success', range: '24+' },
  ],
  '3d6': [
    { outcome: 'bad-luck', range: '≤ 9' },
    { outcome: 'neutral', range: '10–12' },
    { outcome: 'good-luck', range: '13+' },
  ],
};

/**
 * Janela de configuração de uma automação (ação). Personagens e NPCs usam a
 * ficha completa (`CharacterSheetView`).
 *
 * Dono (personagem, NPC ou geral do mestre), rolagem (2d12 ou 3d6 + modificador
 * fixo + tags dos temas do dono), ícone e efeito especial lançado ao usar.
 */
@Component({
  selector: 'app-entry-window',
  imports: [MatIconModule, MatTooltipModule, FxPicker],
  templateUrl: './entry-window.html',
  host: { class: 'flex h-full flex-col overflow-y-auto p-6' },
})
export class EntryWindow {
  readonly session = inject(TableSessionService);

  readonly entryId = input.required<string>();

  readonly entry = computed(() => this.session.entryById().get(this.entryId()));
  readonly meta = computed(() => TABLE_ENTRY_META[this.entry()?.kind ?? 'automation']);
  readonly icons = AUTOMATION_ICONS;
  readonly diceKinds = DICE_KINDS;

  // --- Automação -----------------------------------------------------------

  /** Fichas que podem ser donas da ação (personagens e NPCs). */
  readonly owners = computed(() => this.session.entries().filter((e) => e.kind === 'character' || e.kind === 'npc'));

  readonly roll = computed<RollConfig>(() => this.entry()?.roll ?? DEFAULT_ROLL);
  readonly guide = computed(() => OUTCOME_GUIDE[this.roll().dice]);
  /** O dado da ação aceita tags da ficha? (3d6: só o modificador fixo; as tags ligadas ficam salvas, mas não valem) */
  readonly usesTags = computed(() => rollUsesTags(this.roll().dice));

  /** Trocar o dono desliga as tags do dono anterior. */
  setOwner(value: string): void {
    const { attributes: _, ...roll } = this.roll();
    this.session.updateEntry(this.entryId(), { ownerEntryId: value || undefined, roll });
  }

  // --- Tags do personagem no modificador -----------------------------------

  /** O dono da ação tem ficha com temas (personagem ou NPC). */
  readonly ownerHasSheet = computed(() => {
    const owner = this.session.entryById().get(this.entry()?.ownerEntryId ?? '');
    return !!owner && hasSheet(owner.kind);
  });
  /** Tags e defeitos dos temas do dono + etiquetas dos itens que ele tem equipados. */
  readonly ownerTags = computed(() => this.session.rollTagsOf(this.entry()?.ownerEntryId));
  /** Sinal de cada tag ligada (1; −1 = etiqueta de item ligada como penalidade), por id. */
  private readonly linkedSigns = computed(() => new Map((this.roll().attributes ?? []).map((a) => [baseTagId(a), attributeSign(a)])));
  /** Tags ligadas a esta ação que ainda existem na ficha. */
  readonly linkedTags = computed(() => this.ownerTags().filter((t) => this.linkedSigns().has(t.id)));
  /** Somar as etiquetas de itens ligadas ao total? (padrão: não; elas só aparecem na rolagem) */
  readonly addItems = computed(() => !!this.roll().addItems);
  /** O dono tem etiquetas de itens equipados (mostra a chave "Somar itens ao total"). */
  readonly hasItemTags = computed(() => this.ownerTags().some((t) => t.item));

  toggleAddItems(): void {
    this.patchRoll({ addItems: !this.addItems() || undefined });
  }

  /** Composição do modificador, ex.: "+1 fixo +3 Esgrima −2 Medo = +2 · itens +1 (fora do total)". */
  readonly breakdown = computed(() => {
    // Estudos não entram no modificador (só acumulam SA); itens só com "Somar itens ao total"
    const counted = this.linkedTags().filter((t) => !t.study && (!t.item || this.addItems()));
    const items = this.linkedTags().filter((t) => t.item && !this.addItems());
    const parts = [`${this.modifierText(this.roll().modifier)} fixo`, ...counted.map((t) => `${this.modifierText(this.tagValue(t))} ${t.text}`)];
    const total = counted.reduce((sum, t) => sum + this.tagValue(t), this.roll().modifier);
    const itemSum = items.reduce((sum, t) => sum + this.tagValue(t), 0);
    const outside = items.length ? ` · itens ${this.modifierText(itemSum)} (fora do total)` : '';
    return `${parts.join(' ')} = ${this.modifierText(total)}${outside}`;
  });

  /** Sinal da tag nesta ação: 1 (soma), −1 (penalidade, só itens) ou 0 (desligada). */
  signOf(tag: SheetTagOption): number {
    return this.linkedSigns().get(tag.id) ?? 0;
  }

  /** Valor da tag na rolagem desta ação (nível com o sinal escolhido; desligada = o nível; mágica = o Poder). */
  tagValue(tag: SheetTagOption): number {
    if (tag.magic) return this.power(tag);
    return tag.level * (this.signOf(tag) || 1);
  }

  // --- Tags mágicas: Poder (salvo na ação) e Mana --------------------------

  /** Tags mágicas ligadas a esta ação (cada uma com o seu Poder). */
  readonly linkedMagic = computed(() => this.linkedTags().filter((t) => t.magic));
  /** Mana (Espírito) gasta ao usar a ação. */
  readonly manaCost = computed(() => {
    const entry = this.entry();
    return entry && this.usesTags() ? this.session.manaCostOf(entry) : 0;
  });

  /** Poder da tag mágica nesta ação (1 até o nível atual; sem escolha = o nível). */
  power(tag: SheetTagOption): number {
    return powerOf(tag.level, this.roll().powers?.[tag.id]);
  }

  stepPower(tag: SheetTagOption, delta: number): void {
    this.patchRoll({ powers: { ...this.roll().powers, [tag.id]: powerOf(tag.level, this.power(tag) + delta) } });
  }

  /**
   * Clique na tag: tags dos temas ligam/desligam; etiquetas de itens alternam
   * desligada → bônus → penalidade → desligada. Ids de tags apagadas da ficha são descartados aqui.
   */
  toggleTag(tag: SheetTagOption): void {
    const valid = new Set(this.ownerTags().map((t) => t.id));
    const others = (this.roll().attributes ?? []).filter((a) => valid.has(baseTagId(a)) && baseTagId(a) !== tag.id);
    const sign = this.signOf(tag);
    let next: string | null = null;
    if (!sign) next = tag.id;
    else if (sign > 0 && tag.item) next = NEGATED_TAG_PREFIX + tag.id;
    const attributes = next ? [...others, next] : others;
    // Desligar uma tag mágica descarta o Poder salvo dela
    const { [tag.id]: _dropped, ...kept } = this.roll().powers ?? {};
    const powers = next ? this.roll().powers : Object.keys(kept).length ? kept : undefined;
    this.patchRoll({ attributes: attributes.length ? attributes : undefined, powers });
  }

  tagClass(tag: SheetTagOption): string {
    const sign = this.signOf(tag);
    if (!sign) return 'bg-white/5 text-slate-400 ring-1 ring-white/10 hover:bg-white/10 hover:text-slate-200';
    if (tag.study) return 'bg-amber-400/15 text-amber-100 ring-1 ring-amber-300/50';
    if (tag.magic) return 'bg-violet-500/20 text-violet-100 ring-1 ring-violet-400/50';
    if (tag.item && sign > 0) return 'bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/50';
    return tag.flaw || sign < 0 ? 'bg-red-500/15 text-red-200 ring-1 ring-red-400/50' : 'bg-astral-500/20 text-astral-200 ring-1 ring-astral-400/50';
  }

  /** Dica da tag: tema (ou item equipado) de origem e, nos itens, o que o próximo clique faz. */
  tagHint(tag: SheetTagOption): string {
    if (tag.study) return 'Estudo ou treino: sem modificador; a cada uso, 12+ soma 1 SA, sucesso crítico soma 2 e falha crítica tira 1';
    if (tag.magic) return `${tag.theme} · mágica: vale o Poder escolhido e gasta essa quantidade de Espírito`;
    if (!tag.item) return tag.theme + (tag.flaw ? ' · defeito' : '');
    const sign = this.signOf(tag);
    const next = sign > 0 ? 'clique: penalidade' : sign < 0 ? 'clique: tirar' : 'clique: bônus';
    return `Item equipado · ${tag.theme} (${next})`;
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
