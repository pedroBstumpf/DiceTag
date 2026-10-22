import { TestBed } from '@angular/core/testing';
import { ApiClient, ApiError, FETCH, apiErrorMessage } from './api-client';

/** Resposta falsa no formato do `fetch`. */
const reply = (status: number, body?: unknown) =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body }) as Response;

describe('ApiClient', () => {
  let calls: { url: string; init?: RequestInit }[];
  let next: () => Promise<Response>;
  let api: ApiClient;

  beforeEach(() => {
    calls = [];
    next = async () => reply(200, {});
    TestBed.configureTestingModule({
      providers: [
        {
          provide: FETCH,
          useValue: (url: string, init?: RequestInit) => {
            calls.push({ url, init });
            return next();
          },
        },
      ],
    });
    api = TestBed.inject(ApiClient);
  });

  it('chama /api com o cookie da sessão e corpo em JSON', async () => {
    next = async () => reply(201, { table: { id: 't' } });
    expect(await api.post('/tables', { name: 'Mesa' })).toEqual({ table: { id: 't' } });
    const [{ url, init }] = calls;
    expect(url).toBe('/api/tables');
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('same-origin');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(init?.body).toBe('{"name":"Mesa"}');
  });

  it('204 devolve undefined; GET vai sem corpo', async () => {
    next = async () => reply(204);
    expect(await api.delete('/tables/t')).toBeUndefined();
    await api.get('/tables');
    expect(calls[1].init?.body).toBeUndefined();
  });

  it('erro vira ApiError com a mensagem pronta (validação mostra o campo)', async () => {
    next = async () => reply(400, { error: 'Dados inválidos.', details: [{ path: 'password', message: 'Essa senha é muito comum. Escolha outra.' }] });
    await expect(api.post('/auth/register', {})).rejects.toMatchObject({
      status: 400,
      message: 'Senha: Essa senha é muito comum. Escolha outra.',
    });
  });

  it('servidor fora do ar (rede ou proxy) avisa para ligar o servidor', async () => {
    next = async () => {
      throw new TypeError('Failed to fetch');
    };
    await expect(api.get('/tables')).rejects.toBeInstanceOf(ApiError);
    await expect(api.get('/tables')).rejects.toMatchObject({ status: 0, message: expect.stringContaining('não está respondendo') });
    expect(apiErrorMessage(504, null)).toContain('não está respondendo');
  });

  it('401 avisa quem se inscreveu (sessão vencida)', async () => {
    let expired = 0;
    const stop = api.onUnauthorized(() => expired++);
    next = async () => reply(401, { error: 'Faça login para continuar.' });
    await expect(api.get('/tables')).rejects.toMatchObject({ status: 401, message: 'Faça login para continuar.' });
    expect(expired).toBe(1);
    stop();
    await expect(api.get('/tables')).rejects.toBeInstanceOf(ApiError);
    expect(expired).toBe(1);
  });

  it('erro interno mostra só uma mensagem genérica e o código para o suporte', () => {
    expect(apiErrorMessage(500, { error: 'Erro interno.', requestId: '12345678-aaaa' })).toBe('Erro no servidor. Tente de novo. (código 12345678)');
  });

  it('health: true só com o servidor respondendo', async () => {
    expect(await api.health()).toBe(true);
    next = async () => {
      throw new TypeError('Failed to fetch');
    };
    expect(await api.health()).toBe(false);
  });
});
