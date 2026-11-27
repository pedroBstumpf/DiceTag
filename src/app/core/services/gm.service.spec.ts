import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { GmOverview, GmService } from './gm.service';
import { ServerApiService } from './server-api.service';

/** GmService: lê o resumo do Painel do Mestre e expõe carregando/erro sem perder o último resumo. */
describe('GmService', () => {
  const overview: GmOverview = { tables: [], totals: { tables: 0, players: 0, pendingInvites: 0, online: 0 } };

  function setup(get: () => Promise<unknown>) {
    const api = { get: vi.fn(get) };
    TestBed.configureTestingModule({ providers: [{ provide: ServerApiService, useValue: api }] });
    return { service: TestBed.inject(GmService), api };
  }

  it('deve buscar /gm/overview e guardar o resumo', async () => {
    const { service, api } = setup(() => Promise.resolve(overview));
    await service.load();
    expect(api.get).toHaveBeenCalledWith('/gm/overview');
    expect(service.overview()).toEqual(overview);
    expect(service.loading()).toBe(false);
  });

  it('deve manter o resumo anterior e desligar o carregando quando o servidor falha', async () => {
    let fail = false;
    const { service } = setup(() => (fail ? Promise.reject(new Error('Servidor desligado.')) : Promise.resolve(overview)));
    await service.load();
    fail = true;
    await expect(service.load()).rejects.toThrow('Servidor desligado.');
    expect(service.overview()).toEqual(overview);
    expect(service.loading()).toBe(false);
  });
});
