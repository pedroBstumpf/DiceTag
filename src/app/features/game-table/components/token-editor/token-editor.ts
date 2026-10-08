import { Component, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  MAX_TOKEN_SPEED,
  METERS_PER_SQUARE,
  MIN_TOKEN_SPEED,
  TOKEN_COLORS,
  TOKEN_SIZES,
  TokenBar,
  TokenTag,
  TokenVision,
  isStatusBar,
} from '../../../../core/models/table-session.model';
import { newId } from '../../../../core/utils/id';
import { ColorPicker } from '../../../../shared/components/color-picker/color-picker';
import { TagEditor } from '../../../../shared/components/tag-editor/tag-editor';
import { TokenPatch } from '../../services/table-session.service';

/** Valores exibidos no editor (ficha ou token colocado). */
export interface TokenEditorValue {
  size: number;
  vision: TokenVision;
  /** Quadrados por segundo com WASD/setas. */
  speed: number;
  bars: TokenBar[];
  tags: TokenTag[];
}

/**
 * Editor das configurações de um token: tamanho, visão, velocidade, barras e etiquetas.
 * Não grava nada sozinho — emite `changed` com o trecho alterado, e quem usa
 * decide onde gravar (ficha ou token colocado, conforme a regra de vínculo).
 */
@Component({
  selector: 'app-token-editor',
  imports: [MatIconModule, MatTooltipModule, ColorPicker, TagEditor],
  templateUrl: './token-editor.html',
  host: { class: 'flex flex-col gap-5' },
})
export class TokenEditor {
  readonly value = input.required<TokenEditorValue>();
  readonly changed = output<TokenPatch>();

  readonly sizes = TOKEN_SIZES;
  readonly metersPerSquare = METERS_PER_SQUARE;
  readonly colors = TOKEN_COLORS;

  // --- Tamanho e visão -----------------------------------------------------

  /** O tamanho é um dos botões? (a alça do mapa permite passos de 0,5) */
  isPresetSize(size: number): boolean {
    return (TOKEN_SIZES as readonly number[]).includes(size);
  }

  setSize(size: number): void {
    this.changed.emit({ size });
  }

  toggleVision(): void {
    const vision = this.value().vision;
    this.changed.emit({ vision: { ...vision, enabled: !vision.enabled } });
  }

  setRange(raw: string): void {
    const range = Number(raw);
    if (Number.isFinite(range) && range >= 0) this.changed.emit({ vision: { ...this.value().vision, range } });
  }

  squares(meters: number): string {
    return (meters / METERS_PER_SQUARE).toFixed(1).replace('.0', '');
  }

  /** Botões −/+ da velocidade (passos de 0,5 quadrado/s, dentro dos limites). */
  stepSpeed(delta: number): void {
    const speed = Math.min(MAX_TOKEN_SPEED, Math.max(MIN_TOKEN_SPEED, this.value().speed + delta));
    this.changed.emit({ speed });
  }

  readonly minSpeed = MIN_TOKEN_SPEED;
  readonly maxSpeed = MAX_TOKEN_SPEED;

  // --- Barras --------------------------------------------------------------

  addBar(): void {
    const bar: TokenBar = { id: newId(), label: 'PV', value: 10, max: 10, color: TOKEN_COLORS[0] };
    this.changed.emit({ bars: [...this.value().bars, bar] });
  }

  updateBar(id: string, patch: Partial<TokenBar>): void {
    this.changed.emit({ bars: this.value().bars.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
  }

  /** Atualiza valor/máximo a partir de um campo numérico (ignora texto inválido). */
  setBarNumber(bar: TokenBar, field: 'value' | 'max', raw: string): void {
    const n = Number(raw);
    if (raw !== '' && Number.isFinite(n)) this.updateBar(bar.id, { [field]: n });
  }

  /** Botões −/+ do valor da barra. */
  stepBar(bar: TokenBar, delta: number): void {
    this.updateBar(bar.id, { value: bar.value + delta });
  }

  /** Barra de status da ficha do personagem (rótulo e cor fixos, não pode ser removida). */
  isStatus(bar: TokenBar): boolean {
    return isStatusBar(bar);
  }

  removeBar(id: string): void {
    this.changed.emit({ bars: this.value().bars.filter((b) => b.id !== id) });
  }

}
