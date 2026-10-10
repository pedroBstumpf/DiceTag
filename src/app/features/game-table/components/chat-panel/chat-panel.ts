import { DatePipe } from '@angular/common';
import { Component, ElementRef, effect, inject, untracked, viewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ROLL_OUTCOMES, RollResult } from '../../../../core/models/table-session.model';
import { TableSessionService } from '../../services/table-session.service';
import { characterModifier, formatModifier } from '../../utils/dice';

/**
 * Aba Chat do painel da mesa: mensagens digitadas e resultados das rolagens,
 * em ordem, como num chat comum (guardados com a mesa, até MAX_CHAT_MESSAGES).
 * Cartão de rolagem: resultado grande no topo, dados e total no centro e, embaixo,
 * o modificador do personagem e o dos itens equipados, separados por ícones.
 * Enter envia; Shift+Enter quebra a linha.
 */
@Component({
  selector: 'app-chat-panel',
  imports: [DatePipe, MatIconModule, MatTooltipModule],
  host: { class: 'flex h-full min-h-0 flex-col' },
  template: `
    <!-- Mensagens -->
    <div #list class="min-h-0 flex-1 overflow-y-auto p-3">
      @for (m of session.chat(); track m.id) {
        @if (m.roll; as roll) {
          <!-- Rolagem: resultado no topo, dados no centro, modificadores (personagem x itens) embaixo -->
          @let o = outcome(roll);
          <article class="mb-2 flex flex-col items-center gap-2 rounded-lg px-2.5 pb-2 pt-3 text-center ring-1" [class]="o.ring">
            <p class="font-display text-xl leading-tight tracking-wide" [class]="o.text">{{ o.label }}</p>

            <!-- Dados rolados e total -->
            <div class="flex items-center justify-center gap-1.5">
              @for (d of roll.rolls; track $index) {
                <span class="grid size-9 place-items-center rounded-md bg-ink-950/70 text-base font-semibold tabular-nums text-slate-100 ring-1 ring-white/10">{{ d }}</span>
              }
              <span class="px-0.5 text-slate-500">=</span>
              <span class="font-display text-3xl tabular-nums text-star-300">{{ roll.total }}</span>
            </div>

            <!-- Modificadores: etiquetas do personagem (com o fixo) e etiquetas dos itens equipados -->
            <div class="flex items-center justify-center gap-3 text-xs tabular-nums">
              <span class="flex items-center gap-1 text-astral-200" matTooltip="Modificador do personagem (fixo + tags, defeitos e etiquetas)">
                <mat-icon class="!size-4 !text-[16px] text-astral-300">person</mat-icon>
                {{ characterModifier(roll) }}
              </span>
              @let added = roll.itemsAdded !== false;
              <span
                class="flex items-center gap-1"
                [class]="added ? 'text-emerald-200' : 'text-slate-300'"
                [matTooltip]="added ? 'Etiquetas dos itens equipados (somadas ao total)' : 'Etiquetas dos itens equipados (fora do total)'"
              >
                <mat-icon class="!size-4 !text-[16px]" [class]="added ? 'text-emerald-300' : 'text-slate-500'">shield</mat-icon>
                {{ itemModifier(roll) }}
              </span>
              @if (roll.mana) {
                <span class="flex items-center gap-1 text-violet-200" matTooltip="Espírito (Mana) gasto pelas tags mágicas">
                  <mat-icon class="icon-filled !size-4 !text-[16px] text-violet-300">auto_awesome</mat-icon>
                  −{{ roll.mana }}
                </span>
              }
            </div>

            <footer class="flex w-full items-center gap-1.5 border-t border-white/5 pt-1.5 text-[11px]">
              <mat-icon class="!size-3.5 !text-[14px] text-amber-300">{{ roll.icon }}</mat-icon>
              <span class="min-w-0 flex-1 truncate text-left text-slate-400">
                <strong class="text-star-300">{{ m.author }}</strong> · {{ roll.action }}
              </span>
              <span class="font-semibold uppercase tracking-wider text-slate-500">{{ roll.dice }}</span>
              <time class="text-slate-500">{{ m.at | date: 'HH:mm' }}</time>
            </footer>
          </article>
        } @else {
          <!-- Texto -->
          <div class="mb-2 px-1">
            <div class="flex items-baseline gap-1.5 text-xs">
              <strong [class]="m.role === 'gm' ? 'text-violet-300' : 'text-astral-300'">{{ m.author }}</strong>
              <time class="text-[10px] text-slate-500">{{ m.at | date: 'HH:mm' }}</time>
            </div>
            <p class="whitespace-pre-wrap break-words text-sm leading-snug text-slate-200">{{ m.text }}</p>
          </div>
        }
      } @empty {
        <div class="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-slate-500">
          <mat-icon class="!size-8 !text-[32px] text-slate-600">forum</mat-icon>
          <p class="text-sm">Nenhuma mensagem ainda.</p>
          <p class="text-xs">As rolagens das ações também aparecem aqui.</p>
        </div>
      }
    </div>

    <!-- Escrever -->
    <footer class="flex shrink-0 items-end gap-1 border-t border-white/5 p-2">
      @if (session.role() === 'gm' && session.chat().length) {
        <button type="button" class="grid size-9 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-white/10 hover:text-red-300" matTooltip="Limpar chat" (click)="clear()">
          <mat-icon class="!text-[18px]">delete_sweep</mat-icon>
        </button>
      }
      <textarea
        #input
        rows="1"
        class="max-h-28 min-h-9 min-w-0 flex-1 resize-none rounded-lg bg-ink-950/70 px-3 py-2 text-sm text-slate-100 outline-none ring-1 ring-white/5 placeholder:text-slate-500 focus:ring-astral-400/50"
        [placeholder]="session.role() === 'gm' ? 'Mensagem como Mestre…' : 'Mensagem…'"
        (keydown.enter)="onEnter($event, input)"
      ></textarea>
      <button type="button" class="grid size-9 shrink-0 place-items-center rounded-lg text-astral-300 hover:bg-astral-500/15" matTooltip="Enviar (Enter)" (click)="send(input)">
        <mat-icon class="!text-[20px]">send</mat-icon>
      </button>
    </footer>
  `,
})
export class ChatPanel {
  readonly session = inject(TableSessionService);
  private readonly list = viewChild.required<ElementRef<HTMLElement>>('list');

  constructor() {
    // Nova mensagem: rola até o fim (depois de desenhar a mensagem)
    effect(() => {
      this.session.chat().length;
      untracked(() => requestAnimationFrame(() => this.scrollToEnd()));
    });
  }

  /** Enter envia; Shift+Enter quebra a linha. */
  onEnter(event: Event, input: HTMLTextAreaElement): void {
    if ((event as KeyboardEvent).shiftKey) return;
    event.preventDefault();
    this.send(input);
  }

  send(input: HTMLTextAreaElement): void {
    this.session.sendChat(input.value);
    input.value = '';
    input.focus();
  }

  clear(): void {
    if (confirm('Apagar todas as mensagens e rolagens do chat desta mesa?')) this.session.clearChat();
  }

  outcome(roll: RollResult) {
    return ROLL_OUTCOMES[roll.outcome];
  }

  /** Modificador do personagem: tudo menos os itens (fixo + tags dos temas + etiquetas de status). */
  characterModifier(roll: RollResult): string {
    return formatModifier(characterModifier(roll)) || '±0';
  }

  /** Modificador das etiquetas dos itens equipados (rolagens antigas: ±0). */
  itemModifier(roll: RollResult): string {
    return formatModifier(roll.itemModifier ?? 0) || '±0';
  }

  private scrollToEnd(): void {
    const el = this.list().nativeElement;
    el.scrollTop = el.scrollHeight;
  }
}
