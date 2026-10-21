import type { IncomingHttpHeaders } from 'node:http';

/**
 * Conferência da origem da requisição — defesa contra CSRF (um site malicioso fazendo o
 * navegador da vítima enviar requisições com o cookie dela) e contra CSWSH (o mesmo, abrindo
 * o WebSocket da mesa).
 *
 * Regra (BACKEND_SECURITY.md §2): requisições que alteram dados e todo WebSocket precisam do
 * cabeçalho `Origin` com uma origem da lista ALLOWED_ORIGINS, comparada de forma exata. Sem o
 * cabeçalho, a resposta é negar: navegadores atuais sempre o enviam nesses casos, e ferramentas
 * fora do navegador (curl, testes, o script `smoke`) o enviam explicitamente.
 */
export function isAllowedOrigin(headers: IncomingHttpHeaders, allowed: ReadonlySet<string>): boolean {
  const origin = headers.origin;
  return typeof origin === 'string' && allowed.has(origin);
}

/** Métodos que não alteram dados (não exigem a conferência de origem). */
export const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);
