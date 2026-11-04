import { DestroyRef, Injectable, effect, inject, signal, untracked } from '@angular/core';
import { DEFAULT_SOUND_VOLUME, SoundPlay, TableEntry } from '../../../core/models/table-session.model';
import { trackOffset } from '../utils/sound';
import { TableSessionService } from './table-session.service';

/** Faixa carregada: o elemento de áudio e a URL temporária do arquivo. */
interface Track {
  audio: HTMLAudioElement;
  url: string;
}

/** Volume deste navegador (preferência de quem ouve: não muda para os outros). */
const LOCAL_VOLUME_KEY = 'dicetag.soundVolume';

/**
 * Mixer de sons da mesa: toca várias faixas ao mesmo tempo, cada uma com
 * volume e repetição próprios, multiplicados pelo volume mestre.
 *
 * Mantém um HTMLAudioElement por som, independente de janelas.
 * Fornecido na página da mesa: ao sair dela, todos os sons param nesta máquina.
 *
 * - **Mesa local:** o estado de reprodução é só daqui e não é persistido.
 * - **Mesa online:** quem manda é a lista `session.playingSounds`, que vem do servidor. O mestre
 *   toca e para por comandos; todas as máquinas, inclusive a dele, seguem a lista e entram no ponto
 *   certo da faixa (`startedAt`). O navegador pode bloquear o som antes do primeiro clique na
 *   página: `blocked` avisa, e o clique seguinte libera.
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
  /** Volume só desta máquina (0–1), multiplicado pelo resto. */
  readonly localVolume = signal(readLocalVolume());
  /** O navegador bloqueou o som até a pessoa interagir com a página. */
  readonly blocked = signal(false);
  /** Mesa online: faixas iniciadas e o `startedAt` de cada uma (mesmo valor = não recomeça). */
  private readonly started = new Map<string, number>();
  /** Libera o som no primeiro clique depois de um bloqueio. */
  private readonly unblock = () => {
    this.blocked.set(false);
    window.removeEventListener('pointerdown', this.unblock);
    for (const id of this.started.keys()) void this.tracks.get(id)?.audio.play().catch(() => undefined);
  };

  constructor() {
    // Aplica volume/repetição às faixas carregadas e descarta as excluídas
    effect(() => {
      const master = this.session.soundMaster() * this.localVolume();
      const entries = this.session.entryById();
      for (const [id, track] of this.tracks) {
        const entry = entries.get(id);
        if (!entry) this.release(id);
        else this.apply(track.audio, entry, master);
      }
    });

    // Mesa online: segue a lista de sons tocando que vem do servidor
    effect(() => {
      if (!this.session.online()) return;
      const wanted = this.session.playingSounds();
      untracked(() => this.follow(wanted));
    });

    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('pointerdown', this.unblock);
      this.started.clear();
      [...this.tracks.keys()].forEach((id) => this.release(id));
    });
  }

  // --- Controle ------------------------------------------------------------

  isPlaying(id: string): boolean {
    return this.playing().has(id);
  }

  /** Toca ou pausa um som. */
  async toggle(entry: TableEntry): Promise<void> {
    // Mesa online: o pedido vai para o servidor; a tela de todos segue a lista que volta
    if (this.session.online()) {
      this.session.setSoundPlaying(entry.id, !this.isPlaying(entry.id));
      return;
    }
    if (this.isPlaying(entry.id)) {
      this.tracks.get(entry.id)?.audio.pause();
      return;
    }
    const track = await this.trackOf(entry);
    if (!track) return;
    // Faixa que terminou (sem repetição) recomeça do início
    if (track.audio.ended) track.audio.currentTime = 0;
    await track.audio.play().catch(() => this.setPlaying(entry.id, false));
  }

  /** Para todas as faixas e volta cada uma ao início. */
  stopAll(): void {
    if (this.session.online()) {
      this.session.stopAllSounds();
      return;
    }
    for (const { audio } of this.tracks.values()) {
      audio.pause();
      audio.currentTime = 0;
    }
  }

  /** Muda o volume desta máquina (fica guardado neste navegador). */
  setLocalVolume(volume: number): void {
    this.localVolume.set(volume);
    try {
      localStorage.setItem(LOCAL_VOLUME_KEY, String(volume));
    } catch {
      // Sem armazenamento: vale só até sair da mesa
    }
  }

  // --- Mesa online ---------------------------------------------------------

  /** Deixa as faixas desta máquina iguais à lista do servidor. */
  private follow(wanted: readonly SoundPlay[]): void {
    const stillWanted = new Set(wanted.map((p) => p.entryId));
    for (const id of [...this.started.keys()]) {
      if (stillWanted.has(id)) continue;
      this.started.delete(id);
      const audio = this.tracks.get(id)?.audio;
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
    }
    for (const { entryId, startedAt } of wanted) {
      if (this.started.get(entryId) === startedAt) continue;
      this.started.set(entryId, startedAt);
      void this.playFrom(entryId, startedAt);
    }
  }

  /** Toca a faixa a partir do ponto em que ela está para quem já estava ouvindo. */
  private async playFrom(entryId: string, startedAt: number): Promise<void> {
    const entry = this.session.entryById().get(entryId);
    const track = entry && (await this.trackOf(entry));
    if (!track || this.started.get(entryId) !== startedAt) return;
    const { audio } = track;
    if (audio.readyState < HTMLMediaElement.HAVE_METADATA) {
      await new Promise((resolve) => audio.addEventListener('loadedmetadata', resolve, { once: true }));
      if (this.started.get(entryId) !== startedAt) return;
    }
    const offset = trackOffset(Date.now() - startedAt, audio.duration, audio.loop);
    // Faixa sem repetição que já acabou para os outros: não toca
    if (offset === null) return;
    audio.currentTime = offset;
    await audio.play().catch((error: unknown) => {
      if (!(error instanceof DOMException) || error.name !== 'NotAllowedError') return;
      if (!this.blocked()) window.addEventListener('pointerdown', this.unblock);
      this.blocked.set(true);
    });
  }

  // --- Internos ------------------------------------------------------------

  /** A faixa carregada (uma só, mesmo com cliques rápidos). */
  private async trackOf(entry: TableEntry): Promise<Track | undefined> {
    let pending = this.loading.get(entry.id);
    if (!this.tracks.has(entry.id) && !pending) {
      pending = this.load(entry).finally(() => this.loading.delete(entry.id));
      this.loading.set(entry.id, pending);
    }
    return this.tracks.get(entry.id) ?? (await pending);
  }

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
    audio.addEventListener('ended', () => {
      this.setPlaying(entry.id, false);
      // Mesa online: a faixa acabou; o mestre tira da lista (a de quem chega depois não recomeça)
      if (this.session.online() && this.session.role() === 'gm') this.session.setSoundPlaying(entry.id, false);
    });
    this.apply(audio, this.session.entryById().get(entry.id) ?? entry, this.session.soundMaster() * this.localVolume());

    const track = { audio, url };
    this.tracks.set(entry.id, track);
    return track;
  }

  /** Volume efetivo = volume da faixa × volume mestre × volume desta máquina. */
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

/** Volume guardado neste navegador (1 se não houver ou estiver ilegível). */
function readLocalVolume(): number {
  try {
    const saved = Number(localStorage.getItem(LOCAL_VOLUME_KEY));
    return localStorage.getItem(LOCAL_VOLUME_KEY) !== null && saved >= 0 && saved <= 1 ? saved : 1;
  } catch {
    return 1;
  }
}
