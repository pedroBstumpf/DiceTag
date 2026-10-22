import { Injectable, inject } from '@angular/core';
import { ApiClient } from '../../api/api-client';
import { User } from '../../models/user.model';
import { World } from '../../models/world.model';
import type { WorldRepository } from '../world.repository';

/** Mundo como o servidor devolve (`/api/worlds`). */
interface ServerWorld {
  id: string;
  ownerId: string;
  name: string;
  createdAt: number;
}

const toWorld = ({ id, name, createdAt }: ServerWorld): World => ({ id, name, createdAt });

/**
 * Mundos do modo online (`/api/worlds`). O primeiro é criado pelo servidor no cadastro; o limite
 * (2) e as regras de exclusão (sem mesas no mundo, nunca o único) são conferidos lá também.
 */
@Injectable({ providedIn: 'root' })
export class ServerWorldRepository implements WorldRepository {
  private readonly api = inject(ApiClient);

  async worlds(_user: User): Promise<World[]> {
    return (await this.api.get<{ worlds: ServerWorld[] }>('/worlds')).worlds.map(toWorld);
  }

  async createWorld(_user: User, name: string): Promise<World> {
    return toWorld((await this.api.post<{ world: ServerWorld }>('/worlds', { name })).world);
  }

  async renameWorld(_user: User, id: string, name: string): Promise<void> {
    await this.api.patch(`/worlds/${encodeURIComponent(id)}`, { name });
  }

  async removeWorld(_user: User, id: string): Promise<void> {
    await this.api.delete(`/worlds/${encodeURIComponent(id)}`);
  }
}
