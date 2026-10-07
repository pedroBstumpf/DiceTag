import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DEFAULT_SOUND_VOLUME, TableEntry } from '../../../../core/models/table-session.model';
import { AutoFocus } from '../../../../shared/directives/auto-focus.directive';
import { SoundMixerService } from '../../services/sound-mixer.service';
import { TableSessionService } from '../../services/table-session.service';

/**
 * Aba "Sons" do painel da mesa: mixer com várias faixas simultâneas.
 * Cada faixa tem play/pausa, volume e repetição na própria linha (sem janela).
 * Aceita envio de vários arquivos de áudio pelo botão ou arrastando para a aba.
 */
@Component({
  selector: 'app-sound-list',
  imports: [MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule, AutoFocus],
  templateUrl: './sound-list.html',
  host: {
    class: 'flex flex-col gap-3 rounded-lg transition-colors',
    '[class.ring-1]': 'dragOver()',
    '[class.ring-astral-400/60]': 'dragOver()',
    '[class.bg-astral-500/5]': 'dragOver()',
    '(dragover)': 'onDragOver($event)',
    '(dragleave)': 'dragOver.set(false)',
    '(drop)': 'onDrop($event)',
  },
})
export class SoundList {
  readonly session = inject(TableSessionService);
  readonly mixer = inject(SoundMixerService);
  private readonly snackBar = inject(MatSnackBar);

  readonly sounds = computed(() => this.session.entries().filter((e) => e.kind === 'sound'));
  readonly renamingId = signal<string | null>(null);
  readonly dragOver = signal(false);
  /** Delays das barras do equalizador (efeito "tocando"). */
  readonly eqDelays = ['0ms', '-300ms', '-600ms'];

  // --- Faixas --------------------------------------------------------------

  volumeOf(entry: TableEntry): number {
    return entry.volume ?? DEFAULT_SOUND_VOLUME;
  }

  setMaster(value: string): void {
    this.session.setSoundMaster(Number(value));
  }

  setVolume(entry: TableEntry, value: string): void {
    this.session.updateEntry(entry.id, { volume: Number(value) });
  }

  toggleLoop(entry: TableEntry): void {
    this.session.updateEntry(entry.id, { loop: !(entry.loop ?? true) });
  }

  finishRename(entry: TableEntry, value: string): void {
    if (this.renamingId() !== entry.id) return;
    if (value.trim()) this.session.updateEntry(entry.id, { name: value.trim() });
    this.renamingId.set(null);
  }

  /** Exclui o som: o mixer para a faixa e a sessão apaga o arquivo. */
  remove(entry: TableEntry): void {
    if (confirm(`Excluir "${entry.name}"?`)) this.session.removeEntry(entry.id);
  }

  // --- Envio de arquivos ---------------------------------------------------

  async onPicked(input: HTMLInputElement): Promise<void> {
    await this.upload(Array.from(input.files ?? []));
    input.value = '';
  }

  onDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    this.dragOver.set(true);
  }

  async onDrop(event: DragEvent): Promise<void> {
    if (!event.dataTransfer?.files.length) return;
    event.preventDefault();
    this.dragOver.set(false);
    await this.upload(Array.from(event.dataTransfer.files));
  }

  private async upload(files: File[]): Promise<void> {
    const audios = files.filter(isAudio);
    if (audios.length < files.length) this.snackBar.open('Apenas arquivos de áudio são aceitos.');
    for (const file of audios) await this.session.uploadSound(file);
  }
}

/** Áudio pelo tipo MIME ou, se o navegador não informar, pela extensão. */
function isAudio(file: File): boolean {
  return file.type.startsWith('audio/') || /\.(mp3|ogg|oga|wav|m4a|aac|flac|opus|weba)$/i.test(file.name);
}
