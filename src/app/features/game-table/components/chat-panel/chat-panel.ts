import { DatePipe } from '@angular/common';
import { Component, ElementRef, effect, inject, untracked, viewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ROLL_OUTCOMES, RollResult } from '../../../../core/models/table-session.model';
import { TableSessionService } from '../../services/table-session.service';
import { formatModifier } from '../../utils/dice';

/**
 * Aba Chat do painel da mesa: mensagens digitadas e resultados das rolagens,
 * em ordem, como num chat comum (guardados com a mesa, até MAX_CHAT_MESSAGES).
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
          <!-- Rolagem -->
          @let o = outcome(roll);
          <article class="mb-2 rounded-lg p-2.5 ring-1" [class]="o.ring">
            <header class="mb-1.5 flex items-center gap-1.5 text-xs">
              <mat-icon class="!size-4 !text-[16px] text-amber-300">{{ roll.icon }}</mat-icon>
              <span class="min-w-0 flex-1 truncate text-slate-300">
                <strong class="text-star-300">{{ m.author }}</strong> · {{ roll.action }}
              </span>
              <time class="text-[10px] text-slate-500">{{ m.at | date: 'HH:mm' }}</time>
            </header>
            <div class="flex items-center gap-1.5">
              @for (d of roll.rolls; track $index) {
                <span class="grid size-7 place-items-center rounded-md bg-ink-950/70 text-sm font-semibold tabular-nums text-slate-100 ring-1 ring-white/10">{{ d }}</span>
              }
              @if (roll.modifier) {
                <span class="text-sm tabular-nums text-slate-400">{{ modifier(roll) }}</span>
              }
              <span class="text-slate-500">=</span>
              <span class="font-display text-2xl tabular-nums text-star-300">{{ roll.total }}</span>
              <span class="ml-auto text-[10px] font-semibold uppercase tracking-wider text-slate-500">{{ roll.dice }}</span>
            </div>
            <p class="mt-1 font-display text-sm tracking-wide" [class]="o.text">{{ o.label }}</p>
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

  modifier(roll: RollResult): string {
    return formatModifier(roll.modifier);
  }

  private scrollToEnd(): void {
    const el = this.list().nativeElement;
    el.scrollTop = el.scrollHeight;
  }
}
