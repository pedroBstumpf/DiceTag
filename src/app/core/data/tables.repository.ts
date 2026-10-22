import { Injectable, inject } from '@angular/core';
import { APP_MODE } from '../config/app-mode';
import { GameTable, NewGameTable } from '../models/game-table.model';
import { User } from '../models/user.model';
import { LocalTablesRepository } from './local/local-tables.repository';
import { ServerTablesRepository } from './server/server-tables.repository';

/**
 * Mesas da conta ("Minhas mesas", SPEC.md §2). O `GameTablesService` usa só esta interface;
 * a implementação vem do modo do app: IndexedDB (offline) ou o servidor (online, que também
 * lista as mesas em que a conta entrou por convite, com `role: 'player'`).
 */
@Injectable({
  providedIn: 'root',
  useFactory: () => (inject(APP_MODE) === 'online' ? inject(ServerTablesRepository) : inject(LocalTablesRepository)),
})
export abstract class TablesRepository {
  /** Mesas da conta, de qualquer ordem (o serviço ordena). */
  abstract list(user: User): Promise<GameTable[]>;
  abstract create(user: User, data: NewGameTable): Promise<GameTable>;
  /** Exclui a mesa, o estado salvo e os arquivos dela (só o dono). */
  abstract remove(user: User, id: string): Promise<void>;
}
