import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { STATUS_BARS, StatusBarId, StatusMods } from '../../../../core/models/table-session.model';
import { raceTraitsOf } from '../../../../core/models/world-item.model';
import { WorldbuildService } from '../../services/worldbuild.service';

type RaceImageField = 'maleBlobId' | 'femaleBlobId';

/**
 * Imagem padrão de uma Raça (masculina ou feminina): mostra, troca e tira.
 * Carrega o arquivo do serviço (cancelado se a imagem mudar antes de terminar).
 */
@Component({
  selector: 'app-race-image',
  imports: [MatIconModule, MatTooltipModule],
  host: { class: 'flex flex-col gap-1.5' },
  template: `
    <span class="sheet-label">{{ label() }}</span>
    <div class="group relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-ink-950 ring-1 ring-white/10">
      @if (src(); as url) {
        <img [src]="url" alt="" class="size-full object-cover object-top" />
      } @else {
        <div class="grid size-full place-items-center text-slate-600">
          <mat-icon class="!size-10 !text-[40px]">{{ icon() }}</mat-icon>
        </div>
      }
      <button
        type="button"
        class="absolute inset-0 grid place-items-center bg-black/60 text-white opacity-0 transition-opacity hover:opacity-100 focus:opacity-100"
        [attr.aria-label]="(src() ? 'Trocar imagem ' : 'Enviar imagem ') + label().toLowerCase()"
        (click)="input.click()"
      >
        <span class="flex flex-col items-center gap-1 text-xs">
          <mat-icon>add_photo_alternate</mat-icon>
          {{ src() ? 'Trocar' : 'Enviar' }}
        </span>
      </button>
      @if (blobId()) {
        <button
          type="button"
          class="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-md bg-ink-950/80 text-slate-300 opacity-0 transition-opacity hover:text-red-300 focus:opacity-100 group-hover:opacity-100"
          matTooltip="Tirar imagem"
          aria-label="Tirar imagem"
          (click)="cleared.emit()"
        >
          <mat-icon class="!text-[18px]">delete</mat-icon>
        </button>
      }
      <input #input type="file" accept="image/*" hidden (change)="onPicked(input)" />
    </div>
  `,
})
export class RaceImage {
  private readonly service = inject(WorldbuildService);

  readonly label = input.required<string>();
  readonly icon = input.required<string>();
  readonly blobId = input<string | undefined>();
  readonly picked = output<File>();
  readonly cleared = output<void>();

  readonly src = signal<string | null>(null);

  constructor() {
    effect(async (onCleanup) => {
      const blobId = this.blobId();
      this.src.set(null);
      if (!blobId) return;
      let url: string | undefined;
      let cancelled = false;
      onCleanup(() => {
        cancelled = true;
        if (url) URL.revokeObjectURL(url);
      });
      const blob = await this.service.getBlob(blobId);
      if (cancelled || !blob) return;
      url = URL.createObjectURL(blob);
      this.src.set(url);
    });
  }

  onPicked(input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = '';
    if (file?.type.startsWith('image/')) this.picked.emit(file);
  }
}

/**
 * Cartão de uma Raça (janela no Worldbuild e na mesa): nome, características (texto),
 * imagens padrão masculina e feminina (opcionais) e modificadores de status (Corpo, Mente,
 * Espírito). Escolhida na ficha, a raça soma as etiquetas aos rótulos e os modificadores
 * ao máximo das barras.
 */
@Component({
  selector: 'app-race-card',
  imports: [MatIconModule, RaceImage],
  host: { class: 'block h-full overflow-y-auto p-5' },
  template: `
    @if (race(); as r) {
      <!-- Só leitura: o fieldset desabilitado bloqueia todos os campos -->
      <fieldset class="mx-auto flex min-w-0 max-w-md flex-col gap-4" [disabled]="readonly()">
        <input
          #nameInput
          class="w-full bg-transparent font-display text-2xl text-star-300 outline-none placeholder:text-slate-600"
          placeholder="Nome da raça"
          aria-label="Nome da raça"
          [value]="r.name"
          (blur)="service.rename(r.id, nameInput.value)"
          (keydown.enter)="nameInput.blur()"
        />

        <!-- Imagens padrão (opcionais) -->
        <section class="sheet-card">
          <h4 class="sheet-title">Imagens padrão</h4>
          <div class="grid grid-cols-2 gap-3">
            <app-race-image label="Masculina" icon="man" [blobId]="r.maleBlobId" (picked)="setImage(r.id, 'maleBlobId', $event)" (cleared)="service.clearRaceImage(r.id, 'maleBlobId')" />
            <app-race-image label="Feminina" icon="woman" [blobId]="r.femaleBlobId" (picked)="setImage(r.id, 'femaleBlobId', $event)" (cleared)="service.clearRaceImage(r.id, 'femaleBlobId')" />
          </div>
        </section>

        <!-- Modificadores de status: somados ao máximo das barras ao escolher a raça na ficha -->
        <section class="sheet-card">
          <h4 class="sheet-title">Modificadores de status</h4>
          <div class="flex flex-col gap-2">
            @for (bar of statusBars; track bar.id) {
              <div class="flex items-center justify-between gap-3 text-sm">
                <span class="font-semibold" [style.color]="bar.color">{{ bar.label }}</span>
                <div class="flex items-center rounded-md bg-ink-950 ring-1 ring-white/10">
                  <button type="button" class="grid size-8 place-items-center rounded-l-md text-slate-400 hover:bg-white/10" [attr.aria-label]="'Diminuir ' + bar.label" (click)="step(r.id, bar.id, -1)">
                    <mat-icon class="!text-[16px]">remove</mat-icon>
                  </button>
                  <input
                    #modInput
                    type="number"
                    step="1"
                    class="h-8 w-14 bg-transparent text-center text-sm tabular-nums text-slate-100 outline-none"
                    [attr.aria-label]="bar.label + ': modificador'"
                    [value]="modOf(bar.id)"
                    (input)="setMod(r.id, bar.id, modInput.value)"
                  />
                  <button type="button" class="grid size-8 place-items-center rounded-r-md text-slate-400 hover:bg-white/10" [attr.aria-label]="'Aumentar ' + bar.label" (click)="step(r.id, bar.id, 1)">
                    <mat-icon class="!text-[16px]">add</mat-icon>
                  </button>
                </div>
              </div>
            }
          </div>
          <p class="mt-2 text-[11px] leading-relaxed text-slate-500">Somados ao valor máximo das barras do personagem quando a raça é escolhida na ficha.</p>
        </section>

        <!-- Características: texto fixo da raça (sem cor nem nível), viram rótulos do personagem -->
        <section class="sheet-card">
          <h4 class="sheet-title">Características</h4>
          <div class="flex flex-wrap items-center gap-1.5">
            @for (trait of traits(); track trait) {
              <span class="flex h-7 items-center gap-1 rounded-md bg-astral-500/15 pl-2.5 pr-1 text-xs font-medium text-astral-200 ring-1 ring-astral-400/30">
                {{ trait }}
                <button type="button" class="grid size-5 place-items-center rounded text-astral-300/70 hover:bg-white/10 hover:text-white" [attr.aria-label]="'Remover ' + trait" (click)="removeTrait(r.id, trait)">
                  <mat-icon class="!size-3.5 !text-[14px]">close</mat-icon>
                </button>
              </span>
            }
            <input
              #traitInput
              class="h-7 w-44 rounded-md bg-ink-950 px-2 text-xs text-slate-100 outline-none ring-1 ring-white/10 placeholder:text-slate-600 focus:ring-astral-500/60"
              placeholder="+ Característica (Enter)"
              aria-label="Nova característica"
              (keydown.enter)="addTrait(r.id, traitInput)"
              (blur)="addTrait(r.id, traitInput)"
            />
          </div>
          <p class="mt-2 text-[11px] leading-relaxed text-slate-500">Ex.: Longevo, Visão no escuro. Viram rótulos do personagem quando a raça é escolhida na ficha.</p>
        </section>
      </fieldset>
    } @else {
      <p class="p-6 text-center text-sm text-slate-500">Esta raça não existe mais.</p>
    }
  `,
})
export class RaceCard {
  readonly service = inject(WorldbuildService);

  readonly itemId = input.required<string>();
  /** Só leitura (jogador na mesa). */
  readonly readonly = input(false);

  readonly race = computed(() => {
    const item = this.service.byId().get(this.itemId());
    return item?.type === 'race' ? item : undefined;
  });
  readonly traits = computed(() => {
    const race = this.race();
    return race ? raceTraitsOf(race) : [];
  });
  private readonly mods = computed<StatusMods>(() => this.race()?.statusMods ?? {});
  readonly statusBars = STATUS_BARS;

  /** Adiciona a característica digitada (ignora vazio e repetida) e limpa o campo. */
  addTrait(id: string, input: HTMLInputElement): void {
    const trait = input.value.trim();
    input.value = '';
    if (trait && !this.traits().includes(trait)) this.setTraits(id, [...this.traits(), trait]);
  }

  removeTrait(id: string, trait: string): void {
    this.setTraits(id, this.traits().filter((t) => t !== trait));
  }

  /** Grava as características (e descarta as etiquetas antigas, com cor e nível, se houver). */
  private setTraits(id: string, traits: string[]): void {
    this.service.update(id, { traits, tags: undefined });
  }

  modOf(bar: StatusBarId): number {
    return this.mods()[bar] ?? 0;
  }

  step(id: string, bar: StatusBarId, delta: number): void {
    this.patchMod(id, bar, this.modOf(bar) + delta);
  }

  /** Valor digitado (inteiro; texto inválido é ignorado). */
  setMod(id: string, bar: StatusBarId, raw: string): void {
    const n = Number(raw);
    if (raw.trim() !== '' && raw.trim() !== '-' && Number.isFinite(n)) this.patchMod(id, bar, Math.round(n));
  }

  setImage(id: string, field: RaceImageField, file: File): void {
    void this.service.setRaceImage(id, field, file);
  }

  private patchMod(id: string, bar: StatusBarId, value: number): void {
    this.service.update(id, { statusMods: { ...this.mods(), [bar]: value } });
  }
}
