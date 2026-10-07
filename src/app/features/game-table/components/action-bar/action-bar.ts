import { Component, computed, inject, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TableEntry } from '../../../../core/models/table-session.model';
import { TableSessionService } from '../../services/table-session.service';

/** Quantidade de espaços na barra (atalhos 1–9 e 0). */
const SLOT_COUNT = 10;

/**
 * Barra de ações (inferior da mesa).
 * Mostra as automações do papel atual — mestre ou jogador — em espaços
 * numerados, usáveis com clique ou pelas teclas 1–0.
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

  /** Usa a ação do espaço (ou cria uma nova, se vazio). */
  trigger(index: number): void {
    const entry = this.slots()[index]?.entry;
    if (!entry) {
      const created = this.session.addEntry('automation');
      this.opened.emit(created.id);
      return;
    }
    this.flashing.set(entry.id);
    setTimeout(() => this.flashing.set(null), 350);
    this.used.emit(entry);
  }
}
