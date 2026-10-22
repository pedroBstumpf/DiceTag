import { Injectable, inject } from '@angular/core';
import { APP_MODE } from '../config/app-mode';
import { User } from '../models/user.model';
import { World } from '../models/world.model';
import { LocalWorldRepository } from './local/local-world.repository';
import { ServerWorldRepository } from './server/server-world.repository';

/**
 * Mundos da conta (SPEC.md §2). O `WorldsService` usa só esta interface; a implementação vem
 * do modo do app: IndexedDB (offline) ou o servidor (online). Os itens do Worldbuild de cada
 * mundo entram aqui na ligação do Worldbuild ao servidor.
 */
@Injectable({
  providedIn: 'root',
  useFactory: () => (inject(APP_MODE) === 'online' ? inject(ServerWorldRepository) : inject(LocalWorldRepository)),
})
export abstract class WorldRepository {
  /** Mundos da conta, do mais antigo ao mais novo (sempre há pelo menos um). */
  abstract worlds(user: User): Promise<World[]>;
  abstract createWorld(user: User, name: string): Promise<World>;
  abstract renameWorld(user: User, id: string, name: string): Promise<void>;
  /** Exclui o mundo com os itens e arquivos dele. Lança com o motivo se não puder. */
  abstract removeWorld(user: User, id: string): Promise<void>;
}
