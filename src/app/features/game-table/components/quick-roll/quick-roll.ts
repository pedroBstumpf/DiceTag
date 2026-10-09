import { Component, computed, inject, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DICE_KINDS, DiceKind, ROLL_OUTCOMES } from '../../../../core/models/table-session.model';
import { Tag } from '../../../../core/models/tag.model';
import { AutoFocus } from '../../../../shared/directives/auto-focus.directive';
import { SheetTagOption, TableSessionService } from '../../services/table-session.service';
import { StatusPick, formatModifier, levelUpText, quickModifier, rollUsesTags } from '../../utils/dice';

/** Tags e defeitos de um tema (ou etiquetas de um item equipado), para agrupar no painel. */
interface ThemeGroup {
  theme: string;
  tags: SheetTagOption[];
}

/** Agrupa as tags pela origem (tema ou item), na ordem da ficha. */
function groupByTheme(tags: SheetTagOption[]): ThemeGroup[] {
  const groups = new Map<string, SheetTagOption[]>();
  for (const tag of tags) groups.set(tag.theme, [...(groups.get(tag.theme) ?? []), tag]);
  return [...groups].map(([theme, list]) => ({ theme, tags: list }));
}

/**
 * Painel da rolagem básica (botão "Rolar" da barra de ações): 2d12 ou 3d6 + um modificador
 * escolhido na hora, sem automação. No 2d12, pode somar as tags e defeitos dos temas, as etiquetas
 * dos itens equipados e as etiquetas de status da ficha de quem age (`session.actorSheetId`): cada etiqueta (de status ou
 * de item) vira bônus ou penalidade (clique alterna desligada → + → −). O 3d6 usa só o modificador fixo.
 * Nada é salvo: ao abrir de novo, começa do zero.
 */
@Component({
  selector: 'app-quick-roll',
  imports: [MatIconModule, MatTooltipModule, AutoFocus],
  templateUrl: './quick-roll.html',
  host: { class: 'block w-80 max-w-[calc(100vw-2rem)]', '(keydown.escape)': 'done.emit()' },
})
export class QuickRoll {
  private readonly session = inject(TableSessionService);
  private readonly snackBar = inject(MatSnackBar);

  /** Rolou ou foi fechado (quem abriu esconde o painel). */
  readonly done = output<void>();

  readonly diceKinds = DICE_KINDS;
  readonly dice = signal<DiceKind>('2d12');
  /** Modificador fixo digitado. */
  readonly fixed = signal(0);
  /** O dado escolhido aceita etiquetas? (3d6: só o modificador fixo) */
  readonly usesTags = computed(() => rollUsesTags(this.dice()));

  // --- Ficha de quem rola --------------------------------------------------

  private readonly sheetId = this.session.actorSheetId;
  private readonly data = computed(() => {
    const id = this.sheetId();
    return id ? this.session.sheetData(id) : null;
  });
  /** Nome de quem rola (ficha de quem age ou o mestre/conta). */
  readonly author = computed(() => this.data()?.name ?? (this.session.role() === 'gm' ? 'Mestre' : 'Sem personagem'));

  /** Tags e defeitos dos temas, por tema (só temas com alguma tag). */
  readonly themeGroups = computed(() => groupByTheme(this.session.themeTagsOf(this.sheetId() ?? undefined)));
  /** Etiquetas dos itens equipados, por item (bônus ou penalidade do nível; sem nível, 1). */
  readonly itemGroups = computed(() => groupByTheme(this.session.itemTagsOf(this.sheetId() ?? undefined)));
  /** Etiquetas de status da ficha (as mesmas do token). */
  readonly statusTags = computed<Tag[]>(() => this.data()?.tags ?? []);
  /** Estudos e Treinos do personagem (ligados sem modificador; acumulam SA ao rolar). */
  readonly studies = computed(() => this.session.studyTagsOf(this.sheetId() ?? undefined));
  private readonly studyPicks = signal(new Set<string>());

  isStudying(study: SheetTagOption): boolean {
    return this.studyPicks().has(study.id);
  }

  toggleStudy(study: SheetTagOption): void {
    this.studyPicks.update((set) => {
      const next = new Set(set);
      if (!next.delete(study.id)) next.add(study.id);
      return next;
    });
  }

  /** SA/SN atuais de um estudo (para mostrar o avanço no botão). */
  studyProgress(study: SheetTagOption): string {
    const s = this.data()?.sheet.studies.find((x) => x.id === study.id);
    return s ? `${s.sa}/${s.sn || '?'}` : '';
  }

  // --- Escolhas (só desta rolagem) -----------------------------------------

  private readonly themePicks = signal(new Set<string>());
  private readonly statusPicks = signal(new Map<string, 1 | -1>());

  isPicked(tag: SheetTagOption): boolean {
    return this.themePicks().has(tag.id);
  }

  toggleTheme(tag: SheetTagOption): void {
    this.themePicks.update((set) => {
      const next = new Set(set);
      if (!next.delete(tag.id)) next.add(tag.id);
      return next;
    });
  }

  /**
   * Sinal de uma etiqueta de status ou de item equipado: 1 (bônus), −1 (penalidade) ou
   * 0 (fora da rolagem). Os ids não se misturam: os de item têm o prefixo `item:`.
   */
  statusSign(tag: { id: string }): number {
    return this.statusPicks().get(tag.id) ?? 0;
  }

  /** Clique na etiqueta (de status ou de item): desligada → bônus → penalidade → desligada. */
  cycleStatus(tag: { id: string }): void {
    this.statusPicks.update((map) => {
      const next = new Map(map);
      const sign = next.get(tag.id);
      if (!sign) next.set(tag.id, 1);
      else if (sign === 1) next.set(tag.id, -1);
      else next.delete(tag.id);
      return next;
    });
  }

  /** Valor da etiqueta de status na rolagem (sem nível = 1). */
  statusValue(tag: Tag): number {
    return tag.level || 1;
  }

  /** Parte do modificador vinda dos itens equipados (bônus ou penalidade, conforme o clique). */
  readonly itemModifier = computed(() =>
    this.usesTags() ? quickModifier(0, [], this.signedPicks(this.itemGroups().flatMap((g) => g.tags))) : 0,
  );

  /** Modificador total desta rolagem: fixo + temas + etiquetas de status + itens (3d6: só o fixo). */
  readonly modifier = computed(() => {
    if (!this.usesTags()) return this.fixed();
    const levels = this.themeGroups()
      .flatMap((g) => g.tags)
      .filter((t) => this.themePicks().has(t.id))
      .map((t) => t.level);
    return quickModifier(this.fixed(), levels, this.signedPicks(this.statusTags())) + this.itemModifier();
  });

  /** Etiquetas escolhidas (de status ou de item), com o sinal do clique. */
  private signedPicks(tags: { id: string; level?: number }[]): StatusPick[] {
    return tags.flatMap((t) => {
      const sign = this.statusPicks().get(t.id);
      return sign ? [{ level: t.level, sign }] : [];
    });
  }
  readonly formula = computed(() => this.dice() + formatModifier(this.modifier()));

  // --- Modificador fixo ----------------------------------------------------

  step(delta: number): void {
    this.fixed.update((v) => v + delta);
  }

  /** Valor digitado (inteiro; texto inválido é ignorado). */
  setFixed(raw: string): void {
    const n = Number(raw);
    if (raw.trim() !== '' && Number.isFinite(n)) this.fixed.set(Math.round(n));
  }

  formatLevel(level: number): string {
    return formatModifier(level) || '0';
  }

  // --- Rolar ---------------------------------------------------------------

  roll(): void {
    const studies = this.usesTags() ? this.studies().filter((s) => this.studyPicks().has(s.id)).map((s) => s.id) : [];
    const { author, roll, levelUps } = this.session.quickRoll(this.dice(), this.modifier(), this.sheetId(), this.itemModifier(), studies);
    const text = `${author} · ${roll.dice}${formatModifier(roll.modifier)} = ${roll.total} — ${ROLL_OUTCOMES[roll.outcome].label}`;
    this.snackBar.open(text, undefined, { duration: 3500 });
    // Estudo que alcançou o SN: notificação em destaque (também vai para o chat)
    if (levelUps.length) this.snackBar.open(levelUpText(levelUps), 'OK', { duration: 8000 });
    this.done.emit();
  }
}
