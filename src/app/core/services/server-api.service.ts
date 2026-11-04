import { Injectable } from '@angular/core';

/** Erro devolvido pelo servidor (ou por não conseguir falar com ele), com a mensagem pronta para a tela. */
export class ServerError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Mensagem quando o servidor não responde (desligado ou sem o proxy do `ng serve`). */
export const SERVER_OFFLINE = 'Servidor fora do ar. Abra-o com "npm run dev" na pasta server/.';

/**
 * Cliente HTTP mínimo da API do servidor (`/api`, ver server/README.md).
 *
 * - URLs relativas: em desenvolvimento o `ng serve` repassa `/api` ao servidor (proxy.conf.json),
 *   então front e servidor ficam na mesma origem e o cookie de sessão (HttpOnly) vai sozinho.
 * - O navegador envia o cabeçalho `Origin` nas alterações, que o servidor exige contra CSRF.
 * - Erros viram `ServerError` com a mensagem do servidor (em PT-BR) ou um aviso de servidor fora do ar.
 */
@Injectable({ providedIn: 'root' })
export class ServerApiService {
  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body: unknown = {}): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  /** `keepalive`: a gravação continua mesmo se a página estiver fechando (corpos pequenos). */
  put<T = unknown>(path: string, body: unknown, keepalive = false): Promise<T> {
    return this.request<T>('PUT', path, body, keepalive);
  }

  patch<T = unknown>(path: string, body: unknown, keepalive = false): Promise<T> {
    return this.request<T>('PATCH', path, body, keepalive);
  }

  delete<T = void>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('DELETE', path, body);
  }

  /** Envia um arquivo (multipart, campo único `file`); o navegador monta o cabeçalho do envio. */
  upload<T>(path: string, file: Blob, name: string): Promise<T> {
    const form = new FormData();
    form.append('file', file, name);
    return this.request<T>('POST', path, form);
  }

  /** Baixa um arquivo; undefined se não existir ou a conta não puder vê-lo (404) ou sem conexão. */
  async getBlob(path: string): Promise<Blob | undefined> {
    try {
      const res = await fetch(`/api${path}`, { credentials: 'same-origin' });
      return res.ok ? await res.blob() : undefined;
    } catch {
      return undefined;
    }
  }

  // --- Internos ------------------------------------------------------------

  private async request<T>(method: string, path: string, body?: unknown, keepalive = false): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`/api${path}`, {
        method,
        credentials: 'same-origin',
        keepalive,
        // FormData (envio de arquivo) leva o próprio Content-Type, com o separador das partes
        headers: body === undefined || body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      });
    } catch {
      throw new ServerError(0, SERVER_OFFLINE);
    }
    if (res.status === 204) return undefined as T;
    const data = await res.json().catch(() => null);
    // Sem JSON: o proxy respondeu no lugar do servidor (ele está desligado)
    if (data === null) throw new ServerError(res.status, SERVER_OFFLINE);
    if (!res.ok) throw new ServerError(res.status, errorMessage(data));
    return data as T;
  }
}

/** Mensagem do corpo de erro do servidor: `{ error, details? }` (details = problemas de validação). */
function errorMessage(data: { error?: string; details?: { message: string }[] }): string {
  return data.details?.[0]?.message ?? data.error ?? 'Algo deu errado no servidor.';
}
