import { CdkConnectedOverlay, CdkOverlayOrigin, ConnectedPosition } from '@angular/cdk/overlay';
import { Component, computed, inject, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TableEntry, hasSheet } from '../../../../core/models/table-session.model';
import { ACT_SELECTION, TableSessionService } from '../../services/table-session.service';
import { QuickRoll } from '../quick-roll/quick-roll';

/** Quantidade de espaços na barra (atalhos 1–9 e 0). */
const SLOT_COUNT = 10;

/**
 * Barra de ações (inferior da mesa).
 * Mostra as ações de quem está agindo (`session.actor`): o mestre escolhe no menu
 * "Agindo" — uma ficha fixa (personagem ou NPC), as ações gerais ou seguir o token
 * selecionado; o jogador age com o personagem dele. Espaços numerados, usáveis com
 * clique ou teclas 1–0. Espaço vazio cria ação só para o mestre (o jogador cria na ficha).
 * À direita, a ação padrão "Rolar" (QuickRoll): rolagem básica com modificador na hora.
 */
@Component({
  selector: 'app-action-bar',
  imports: [CdkOverlayOrigin, CdkConnectedOverlay, MatIconModule, MatMenuModule, MatTooltipModule, QuickRoll],
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

  /** Só o mestre cria ações pela barra; o jogador cria na aba Habilidades da própria ficha. */
  readonly canCreate = computed(() => this.session.role() === 'gm');

  /** Dica do espaço vazio. */
  readonly emptyHint = computed(() => {
    if (this.canCreate()) return 'Nova ação para ' + this.actorLabel();
    return this.session.actor() ? 'Crie ações na aba Habilidades da sua ficha' : 'Crie um personagem para ter ações';
  });

  /** Rótulo de quem está agindo. */
  readonly actorLabel = computed(() => {
    const actor = this.session.actor();
    if (actor) return actor.name;
    if (this.session.role() !== 'gm') return 'Sem personagem';
    return this.following() ? 'Nenhum token' : 'Ações gerais';
  });

  // --- Mestre: escolher quem age -------------------------------------------

  readonly selection = ACT_SELECTION;
  /** O mestre está seguindo o token selecionado (senão, a escolha é fixa). */
  readonly following = computed(() => this.session.gmActing() === ACT_SELECTION);
  /** Personagens e NPCs da mesa, para o mestre agir como eles. */
  readonly actingOptions = computed(() => this.session.entries().filter((e) => hasSheet(e.kind)));

  // --- Rolagem básica (ação padrão, sempre disponível) ---------------------

  /** Painel "Rolar dados" aberto. */
  readonly rollOpen = signal(false);
  /** Painel acima do botão, alinhado à direita (abaixo, se não couber). */
  readonly rollPositions: ConnectedPosition[] = [
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -10 },
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 10 },
  ];

  /** Clique fora fecha o painel (o próprio botão já alterna). */
  onRollOutside(event: MouseEvent, button: HTMLElement): void {
    if (!button.contains(event.target as Node)) this.rollOpen.set(false);
  }

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
