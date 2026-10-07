import { Injectable } from '@angular/core';
import { User } from '../../../core/models/user.model';
import { WorldbuildService } from './worldbuild.service';

/**
 * Lore geral: a lore oficial do mundo, igual para todos os usuários
 * (chave global "lore:global" no IndexedDB, em vez de uma por usuário).
 *
 * Mesma estrutura e regras do worldbuild (pastas, documentos, linhas do tempo,
 * imagens). Para reaproveitar a página e os editores, quem usa fornece este
 * serviço no lugar do WorldbuildService (rota /lore e diretiva LoreScope).
 */
@Injectable({ providedIn: 'root' })
export class LoreService extends WorldbuildService {
  override readonly title = 'Lore geral';

  protected override keyFor(user: User | null): string | null {
    return user ? 'lore:global' : null;
  }
}
