import { Component, computed, inject, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TableEntry } from '../../../../core/models/table-session.model';
import { TableSessionService } from '../../services/table-session.service';

/** Quantidade de espaços na barra (atalhos 1–9 e 0). */
const SLOT_COUNT = 10;

/**
 * Barra de ações (inferior da mesa).
 * Mostra as ações de quem está agindo (`session.actor`): para o mestre, a ficha do
 * token selecionado (NPC ou personagem) ou, sem seleção, as ações gerais; para o
 * jogador, o personagem dele. Espaços numerados, usáveis com clique ou teclas 1–0.
 */
@Component({
  selector: 'app-action-bar',
  imports: [MatIconModule, MatTooltipModule],
  templateUrl: './action-bar.html',
})
export class ActionBar {
  readonly session = inject(TableSessionService);

  /** Pedido para abrir a configuração de uma automação. */
  readonly opened = output<string>();
  /** Uma ação foi usada. */
  readonly used = output<TableEntry>();

  /** Espaço acionado recentemente (para o efeito visual). */
  readonly flashing = signal<string | null>(null);

  /** Espaços fixos: automações do papel atual + vazios até completar. */
  readonly slots = computed(() => {
    const actions = this.session.hotbar().slice(0, SLOT_COUNT);
    return Array.from({ length: SLOT_COUNT }, (_, i) => ({
      key: i === 9 ? '0' : String(i + 1),
      entry: (actions[i] as TableEntry | undefined) ?? null,
    }));
  });

  /** Jogador sem personagem nesta mesa não tem onde criar ações. */
  readonly canCreate = computed(() => this.session.role() === 'gm' || !!this.session.actor());

  /** Rótulo de quem está agindo. */
  readonly actorLabel = computed(() => {
    const actor = this.session.actor();
    if (actor) return actor.name;
    return this.session.role() === 'gm' ? 'Ações gerais' : 'Sem personagem';
  });

  /** Usa a ação do espaço (ou cria uma nova para quem está agindo, se vazio). */
  trigger(index: number): void {
    const entry = this.slots()[index]?.entry;
    if (!entry) {
      if (!this.canCreate()) return;
      const owner = this.session.actor()?.id;
      const created = this.session.addEntry('automation', owner ? { ownerEntryId: owner } : {});
      this.opened.emit(created.id);
      return;
    }
    this.flashing.set(entry.id);
    setTimeout(() => this.flashing.set(null), 350);
    this.used.emit(entry);
  }
}
