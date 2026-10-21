import type { FastifyBaseLogger } from 'fastify';

/**
 * Eventos de segurança (BACKEND_SECURITY.md §12), registrados no log do Fastify (pino) com o
 * campo `security`, para filtrar e alertar. Nunca levam senha, token, id de sessão, código de
 * convite nem e-mail em claro: a conta aparece pelo id e o e-mail tentado só como `emailRef`
 * (HMAC truncado, que permite correlacionar tentativas sem guardar o endereço).
 */
export type SecurityEvent =
  | 'conta.criada'
  | 'login.ok'
  | 'login.falha'
  | 'login.bloqueado'
  | 'sessao.encerrada'
  | 'sessoes.encerradas'
  | 'senha.trocada'
  | 'conta.excluida'
  | 'permissao.negada'
  | 'limite.atingido'
  | 'upload.recusado'
  | 'ws.recusado'
  | 'ws.mensagem_invalida'
  | 'ws.comando_negado';

/** Eventos esperados no uso normal (nível info); os demais são suspeitos ou recusas (warn). */
const ROUTINE: ReadonlySet<SecurityEvent> = new Set(['conta.criada', 'login.ok', 'sessao.encerrada', 'sessoes.encerradas', 'senha.trocada', 'conta.excluida']);

export function audit(log: FastifyBaseLogger, event: SecurityEvent, data: Record<string, unknown> = {}): void {
  const entry = { security: event, ...data };
  if (ROUTINE.has(event)) log.info(entry, `segurança: ${event}`);
  else log.warn(entry, `segurança: ${event}`);
}
