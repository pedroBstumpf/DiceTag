import { Component, computed, inject, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TABLE_ENTRY_META } from '../../../../core/models/table-session.model';
import { TableSessionService } from '../../services/table-session.service';

/** Ícones disponíveis para automações (exibidos na barra de ações). */
const AUTOMATION_ICONS = ['bolt', 'swords', 'shield', 'local_fire_department', 'healing', 'auto_awesome', 'casino', 'visibility', 'directions_run', 'psychology'];

/**
 * Ficha aberta pelo painel (personagem, NPC ou automação).
 * A estrutura de cada ficha será construída nas próximas etapas; por enquanto
 * mostra nome editável e, nas automações, a escolha de ícone.
 * As opções do token ficam só no mapa (duplo clique no token).
 */
@Component({
  selector: 'app-entry-window',
  imports: [MatIconModule],
  templateUrl: './entry-window.html',
  host: { class: 'flex h-full flex-col overflow-y-auto p-6' },
})
export class EntryWindow {
  readonly session = inject(TableSessionService);

  readonly entryId = input.required<string>();

  readonly entry = computed(() => this.session.entryById().get(this.entryId()));
  readonly meta = computed(() => TABLE_ENTRY_META[this.entry()?.kind ?? 'character']);
  readonly icons = AUTOMATION_ICONS;

  /** Texto explicando o que virá em cada tipo de janela. */
  readonly upcoming = computed(() => {
    switch (this.entry()?.kind) {
      case 'automation':
        return 'Aqui você vai configurar fórmulas de dados, alvos, custos e efeitos. A ação já aparece na barra inferior.';
      case 'npc':
        return 'A ficha de NPC (atributos, ataques e notas do mestre) será estruturada na próxima etapa.';
      default:
        return 'A ficha de personagem (atributos, perícias, inventário) será estruturada na próxima etapa.';
    }
  });

  rename(value: string): void {
    if (value.trim()) this.session.updateEntry(this.entryId(), { name: value.trim() });
  }
}
