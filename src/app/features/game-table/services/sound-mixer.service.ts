import { DestroyRef, Injectable, effect, inject, signal } from '@angular/core';
import { DEFAULT_SOUND_VOLUME, TableEntry } from '../../../core/models/table-session.model';
import { TableSessionService } from './table-session.service';

/** Faixa carregada: o elemento de áudio e a URL temporária do arquivo. */
interface Track {
  audio: HTMLAudioElement;
  url: string;
}

/**
 * Mixer de sons da mesa: toca várias faixas ao mesmo tempo, cada uma com
 * volume e repetição próprios, multiplicados pelo volume mestre.
 *
 * Mantém um HTMLAudioElement por som, independente de janelas.
 * Fornecido na página da mesa: ao sair dela, todos os sons param.
 * O estado de reprodução (tocando/pausado) não é persistido.
 */
@Injectable()
export class SoundMixerService {
  private readonly session = inject(TableSessionService);

  // --- Estado --------------------------------------------------------------
  private readonly tracks = new Map<string, Track>();
  /** Carregamentos em andamento (evita criar dois áudios com cliques rápidos). */
  private readonly loading = new Map<string, Promise<Track | undefined>>();
  /** Ids dos sons tocando agora. */
  readonly playing = signal<ReadonlySet<string>>(new Set());

  constructor() {
    // Aplica volume/repetição às faixas carregadas e descarta as excluídas
    effect(() => {
      const master = this.session.soundMaster();
      const entries = this.session.entryById();
      for (const [id, track] of this.tracks) {
        const entry = entries.get(id);
        if (!entry) this.release(id);
        else this.apply(track.audio, entry, master);
      }
    });

    inject(DestroyRef).onDestroy(() => [...this.tracks.keys()].forEach((id) => this.release(id)));
  }

  // --- Controle ------------------------------------------------------------

  isPlaying(id: string): boolean {
    return this.playing().has(id);
  }

  /** Toca ou pausa um som. */
  async toggle(entry: TableEntry): Promise<void> {
    if (this.isPlaying(entry.id)) {
      this.tracks.get(entry.id)?.audio.pause();
      return;
    }
    let pending = this.loading.get(entry.id);
    if (!this.tracks.has(entry.id) && !pending) {
      pending = this.load(entry).finally(() => this.loading.delete(entry.id));
      this.loading.set(entry.id, pending);
    }
    const track = this.tracks.get(entry.id) ?? (await pending);
    if (!track) return;
    // Faixa que terminou (sem repetição) recomeça do início
    if (track.audio.ended) track.audio.currentTime = 0;
    await track.audio.play().catch(() => this.setPlaying(entry.id, false));
  }

  /** Para todas as faixas e volta cada uma ao início. */
  stopAll(): void {
    for (const { audio } of this.tracks.values()) {
      audio.pause();
      audio.currentTime = 0;
    }
  }

  // --- Internos ------------------------------------------------------------

  /** Carrega o arquivo do IndexedDB e cria o elemento de áudio. */
  private async load(entry: TableEntry): Promise<Track | undefined> {
    if (!entry.blobId) return undefined;
    const blob = await this.session.getBlob(entry.blobId);
    // O som pode ter sido excluído enquanto o arquivo carregava
    if (!blob || !this.session.entryById().has(entry.id)) return undefined;

    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.addEventListener('play', () => this.setPlaying(entry.id, true));
    audio.addEventListener('pause', () => this.setPlaying(entry.id, false));
    audio.addEventListener('ended', () => this.setPlaying(entry.id, false));
    this.apply(audio, this.session.entryById().get(entry.id) ?? entry, this.session.soundMaster());

    const track = { audio, url };
    this.tracks.set(entry.id, track);
    return track;
  }

  /** Volume efetivo = volume da faixa × volume mestre. */
  private apply(audio: HTMLAudioElement, entry: TableEntry, master: number): void {
    audio.volume = (entry.volume ?? DEFAULT_SOUND_VOLUME) * master;
    audio.loop = entry.loop ?? true;
  }

  /** Para a faixa e libera a memória do arquivo. */
  private release(id: string): void {
    const track = this.tracks.get(id);
    if (!track) return;
    track.audio.pause();
    track.audio.removeAttribute('src');
    URL.revokeObjectURL(track.url);
    this.tracks.delete(id);
    this.setPlaying(id, false);
  }

  private setPlaying(id: string, on: boolean): void {
    this.playing.update((set) => {
      if (set.has(id) === on) return set;
      const next = new Set(set);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }
}
