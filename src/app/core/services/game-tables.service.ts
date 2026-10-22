import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { TablesRepository } from '../data/tables.repository';
import { GameTable, NewGameTable } from '../models/game-table.model';
import { User } from '../models/user.model';
import { AuthService } from './auth.service';

/**
 * Mesas de jogo da conta logada ("Minhas mesas").
 * Recarrega automaticamente quando a conta muda. Os dados vêm do `TablesRepository` do modo em
 * uso (IndexedDB offline; servidor online, com as mesas em que a conta joga por convite).
 */
@Injectable({ providedIn: 'root' })
export class GameTablesService {
  private readonly repository = inject(TablesRepository);
  private readonly auth = inject(AuthService);

  // --- Estado --------------------------------------------------------------
  private readonly all = signal<GameTable[]>([]);
  readonly loaded = signal(false);
  /** Motivo de a lista não ter carregado (ex.: servidor fora do ar); null = carregou. */
  readonly loadError = signal<string | null>(null);
  /** Carregamento mais recente (os anteriores são descartados ao terminar). */
  private loading = 0;

  /** Mesas da conta, mais recentes primeiro. */
  readonly tables = computed(() => [...this.all()].sort((a, b) => b.createdAt - a.createdAt));

  constructor() {
    // Recarrega quando a conta muda (só a conta dispara: o carregamento não é rastreado)
    effect(() => {
      const user = this.auth.user();
      untracked(() => void this.load(user));
    });
  }

  // --- Ações públicas ------------------------------------------------------

  async create(data: NewGameTable): Promise<GameTable> {
    const user = this.auth.user();
    if (!user) throw new Error('É preciso estar logado para criar uma mesa.');
    const table = await this.repository.create(user, data);
    this.all.update((list) => [...list, table]);
    return table;
  }

  /** Busca uma mesa da conta pelo id. */
  getById(id: string): GameTable | undefined {
    return this.all().find((t) => t.id === id);
  }

  /** A conta é dona da mesa? (só o dono exclui; online, só ele convida e remove jogadores) */
  isOwner(table: GameTable): boolean {
    return table.ownerId === this.auth.user()?.id;
  }

  /** Exclui a mesa, o estado salvo dela e todos os arquivos (mapas, sons, tokens). */
  async remove(id: string): Promise<void> {
    const user = this.auth.user();
    if (!user) return;
    await this.repository.remove(user, id);
    this.all.update((list) => list.filter((t) => t.id !== id));
  }

  /** Recarrega a lista (ex.: depois de entrar numa mesa com convite ou de sair de uma). */
  reload(): Promise<void> {
    return this.load(this.auth.user());
  }

  // --- Carregamento --------------------------------------------------------

  private async load(user: User | null): Promise<void> {
    const current = ++this.loading;
    this.loaded.set(false);
    this.loadError.set(null);
    if (!user) {
      this.all.set([]);
      return;
    }
    try {
      const tables = await this.repository.list(user);
      // A conta mudou (ou outro carregamento começou) enquanto este esperava: descarta
      if (current !== this.loading) return;
      this.all.set(tables);
    } catch (err) {
      if (current !== this.loading) return;
      this.all.set([]);
      this.loadError.set(err instanceof Error ? err.message : 'Não foi possível carregar as mesas.');
    } finally {
      if (current === this.loading) this.loaded.set(true);
    }
  }
}
