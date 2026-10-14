import type { IncomingHttpHeaders } from 'node:http';

/**
 * Conferência da origem da requisição — defesa contra CSRF (um site malicioso fazendo o
 * navegador da vítima enviar requisições com o cookie dela) e contra CSWSH (o mesmo, abrindo
 * o WebSocket da mesa).
 *
 * Regra: requisições que alteram dados e todo WebSocket precisam vir de uma origem da lista
 * ALLOWED_ORIGINS. Sem cabeçalho `Origin`, só se o navegador disser `Sec-Fetch-Site: same-origin`.
 * Ferramentas fora do navegador (curl, testes) enviam `Origin` explicitamente.
 */
export function isAllowedOrigin(headers: IncomingHttpHeaders, allowed: ReadonlySet<string>): boolean {
  const origin = headers.origin;
  if (typeof origin === 'string') return allowed.has(origin);
  return headers['sec-fetch-site'] === 'same-origin';
}

/** Métodos que não alteram dados (não exigem a conferência de origem). */
export const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);
