import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TABLE_ACCENTS } from '../../core/models/game-table.model';
import { GmService } from '../../core/services/gm.service';
import { OnlineTablesService } from '../../core/services/online-tables.service';
import { ServerAccountService } from '../../core/services/server-account.service';
import { ServerWorldsService } from '../../core/services/server-worlds.service';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { HostPanel } from '../tables/host-panel/host-panel';
import { GmTableCard } from './components/gm-table-card/gm-table-card';

/**
 * Painel do Mestre (rota `/mestre`, só o dono — ADR-0007): uma tela para abrir a mesa aos jogadores,
 * criar mesas e, em cada uma, ver as informações e convidar, gerenciar jogadores, editar e excluir.
 * O painel não tem poderes próprios: cada ação usa a rota do servidor que já confere o papel.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-gm-panel',
  imports: [MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressSpinnerModule, MatSelectModule, EmptyState, HostPanel, GmTableCard],
  templateUrl: './gm-panel.html',
})
export class GmPanel {
  protected readonly account = inject(ServerAccountService);
  private readonly tables = inject(OnlineTablesService);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly gm = inject(GmService);
  protected readonly worlds = inject(ServerWorldsService);

  protected readonly totals = computed(() => this.gm.overview()?.totals ?? null);
  protected readonly list = computed(() => this.gm.overview()?.tables ?? []);
  /** Falha ao carregar o resumo (servidor desligado, sem conta): mostrada com "Tentar de novo". */
  protected readonly error = signal('');

  // --- Nova mesa ------------------------------------------------------------
  protected readonly newName = signal('');
  /** Mundo escolhido para a mesa nova (vazio = o que o Worldbuild abriria). */
  protected readonly newWorld = signal('');
  protected readonly creating = signal(false);

  constructor() {
    void this.account.ensureChecked();
    // Conta do dono pronta: carrega o resumo e os mundos
    effect(() => {
      if (!this.account.isOwner()) return;
      untracked(() => {
        void this.reload();
        void this.worlds.ensure();
      });
    });
  }

  protected async reload(): Promise<void> {
    try {
      await this.gm.load();
      this.error.set('');
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Não foi possível carregar as mesas.');
    }
  }

  protected async create(): Promise<void> {
    const name = this.newName().trim();
    if (!name || this.creating()) return;
    const worldId = this.newWorld() || this.worlds.preferred() || undefined;
    this.creating.set(true);
    try {
      await this.tables.create({ name, system: 'Sistema próprio', description: '', maxPlayers: 5, accent: TABLE_ACCENTS[0], ...(worldId && { worldId }) });
      this.snackBar.open(`Mesa "${name}" criada.`);
      this.newName.set('');
      await this.reload();
    } catch (e) {
      this.snackBar.open(e instanceof Error ? e.message : 'Não foi possível criar a mesa.', undefined, { duration: 5000 });
    } finally {
      this.creating.set(false);
    }
  }

  protected textOf(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}
