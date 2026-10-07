import { Component, computed, inject, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TABLE_ENTRY_META } from '../../../../core/models/table-session.model';
import { BlobUrlService } from '../../services/blob-url.service';
import { TableSessionService } from '../../services/table-session.service';
import { TokenEditor } from '../token-editor/token-editor';

/** Ícones disponíveis para automações (exibidos na barra de ações). */
const AUTOMATION_ICONS = ['bolt', 'swords', 'shield', 'local_fire_department', 'healing', 'auto_awesome', 'casino', 'visibility', 'directions_run', 'psychology'];

/**
 * Conteúdo das janelas de fichas, NPCs e automações.
 * A estrutura de cada ficha será construída nas próximas etapas; por enquanto
 * mostra nome editável, a seção "Token" (personagem/NPC) e, nas automações,
 * a escolha de ícone.
 */
@Component({
  selector: 'app-entry-window',
  imports: [MatButtonModule, MatIconModule, TokenEditor],
  templateUrl: './entry-window.html',
  host: { class: 'flex h-full flex-col overflow-y-auto p-6' },
})
export class EntryWindow {
  readonly session = inject(TableSessionService);
  readonly blobs = inject(BlobUrlService);

  readonly entryId = input.required<string>();
  /** Pedido para colocar o token desta ficha no centro do mapa. */
  readonly placeOnMap = output<string>();

  readonly entry = computed(() => this.session.entryById().get(this.entryId()));
  readonly meta = computed(() => TABLE_ENTRY_META[this.entry()?.kind ?? 'character']);
  readonly icons = AUTOMATION_ICONS;

  /** Personagens e NPCs têm token. */
  readonly hasToken = computed(() => this.entry()?.kind === 'character' || this.entry()?.kind === 'npc');
  readonly token = computed(() => {
    const entry = this.entry();
    return entry ? this.session.tokenOf(entry) : null;
  });

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

  /** Envia (ou troca) a imagem do token. */
  async onImagePicked(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (file?.type.startsWith('image/')) await this.session.setTokenImage(this.entryId(), file);
  }
}
