import { Injectable, InjectionToken, inject } from '@angular/core';

/** Função de rede usada pelo cliente (o `fetch` do navegador; os testes trocam por uma falsa). */
export const FETCH = new InjectionToken<typeof fetch>('FETCH', {
  providedIn: 'root',
  factory: () => globalThis.fetch.bind(globalThis),
});

/** Detalhe de validação devolvido pelo servidor (campo + mensagem, nunca o valor enviado). */
export interface ApiErrorDetail {
  path: string;
  message: string;
}

/** Erro de uma chamada à API, com a mensagem pronta para mostrar à pessoa. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details: readonly ApiErrorDetail[] = [],
  ) {
    super(message);
  }
}

/** Nome dos campos nas mensagens de validação ("Senha: mínimo de 8 caracteres"). */
const FIELD_LABELS: Record<string, string> = {
  name: 'Nome',
  email: 'E-mail',
  password: 'Senha',
  current: 'Senha atual',
  next: 'Nova senha',
  code: 'Código',
  description: 'Descrição',
  system: 'Sistema',
  maxPlayers: 'Jogadores',
};

const OFFLINE = 'O servidor não está respondendo. Ele está ligado? (pasta server: npm run dev)';

/**
 * Mensagem para a pessoa a partir da resposta de erro do servidor. Erros de validação trazem o
 * motivo no primeiro detalhe (ex.: "Essa senha é muito comum"); 5xx viram uma mensagem genérica
 * (o detalhe fica no log do servidor, achado pelo `requestId`).
 */
export function apiErrorMessage(status: number, body: unknown): string {
  const data = (body ?? {}) as { error?: unknown; details?: ApiErrorDetail[]; requestId?: unknown };
  if (status === 502 || status === 503 || status === 504) return OFFLINE;
  if (status >= 500) return `Erro no servidor. Tente de novo.${typeof data.requestId === 'string' ? ` (código ${data.requestId.slice(0, 8)})` : ''}`;
  const detail = data.details?.[0];
  if (detail) return FIELD_LABELS[detail.path] ? `${FIELD_LABELS[detail.path]}: ${detail.message}` : detail.message;
  return typeof data.error === 'string' && data.error ? data.error : 'Não foi possível concluir. Tente de novo.';
}

/**
 * Cliente da API do servidor (`/api`), usado pelas implementações online de `core/data`.
 *
 * - Endereços relativos: em desenvolvimento o `ng serve` repassa ao servidor (`proxy.conf.json`);
 *   em produção o próprio servidor entrega o app. O mesmo código vale nos dois casos.
 * - A sessão é o cookie HttpOnly do servidor (`credentials: same-origin`): o app nunca vê o token.
 * - O navegador envia o cabeçalho `Origin` sozinho nas alterações (o servidor exige: CSRF).
 * - Erros viram `ApiError` com a mensagem pronta; 401 avisa quem se inscreveu em
 *   `onUnauthorized` (a sessão venceu ou foi encerrada em outro lugar).
 */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly fetcher = inject(FETCH);
  private readonly unauthorizedListeners = new Set<() => void>();

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  delete<T = void>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('DELETE', path, body);
  }

  /** O servidor está no ar? (rota pública, não depende de sessão) */
  async health(): Promise<boolean> {
    try {
      const res = await this.fetcher('/api/health', { credentials: 'same-origin' });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Avisa quando o servidor responde 401 (sessão vencida). Devolve a função que cancela o aviso. */
  onUnauthorized(listener: () => void): () => void {
    this.unauthorizedListeners.add(listener);
    return () => this.unauthorizedListeners.delete(listener);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetcher(`/api${path}`, {
        method,
        credentials: 'same-origin',
        ...(body !== undefined && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      });
    } catch {
      throw new ApiError(0, OFFLINE);
    }
    if (res.status === 204) return undefined as T;
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 401) this.unauthorizedListeners.forEach((listener) => listener());
      throw new ApiError(res.status, apiErrorMessage(res.status, data), (data as { details?: ApiErrorDetail[] } | null)?.details ?? []);
    }
    return data as T;
  }
}
