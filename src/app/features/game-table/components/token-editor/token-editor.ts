import { Component, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  METERS_PER_SQUARE,
  TOKEN_COLORS,
  TOKEN_SIZES,
  TokenBar,
  TokenTag,
  TokenVision,
} from '../../../../core/models/table-session.model';
import { newId } from '../../../../core/utils/id';
import { ColorPicker } from '../../../../shared/components/color-picker/color-picker';
import { TokenPatch } from '../../services/table-session.service';

/** Valores exibidos no editor (ficha ou token colocado). */
export interface TokenEditorValue {
  size: number;
  vision: TokenVision;
  bars: TokenBar[];
  tags: TokenTag[];
}

/**
 * Editor das configurações de um token: tamanho, visão, barras e etiquetas.
 * Não grava nada sozinho — emite `changed` com o trecho alterado, e quem usa
 * decide onde gravar (ficha ou token colocado, conforme a regra de vínculo).
 */
@Component({
  selector: 'app-token-editor',
  imports: [MatIconModule, MatTooltipModule, ColorPicker],
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

  removeBar(id: string): void {
    this.changed.emit({ bars: this.value().bars.filter((b) => b.id !== id) });
  }

  // --- Etiquetas -----------------------------------------------------------

  addTag(): void {
    const tag: TokenTag = { id: newId(), text: 'Etiqueta', color: TOKEN_COLORS[1] };
    this.changed.emit({ tags: [...this.value().tags, tag] });
  }

  updateTag(id: string, patch: Partial<TokenTag>): void {
    this.changed.emit({ tags: this.value().tags.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  }

  removeTag(id: string): void {
    this.changed.emit({ tags: this.value().tags.filter((t) => t.id !== id) });
  }

}
