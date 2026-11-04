import type { Config } from '../config/env';

/**
 * Nome do cookie de sessão. Com HTTPS usa o prefixo `__Host-`: o navegador só aceita o cookie
 * se ele for `Secure`, com `Path=/` e sem `Domain` — nenhum subdomínio consegue sobrescrevê-lo.
 * Usado pelo HTTP (`plugins/auth.ts`) e pelo WebSocket (`realtime/hub.ts`).
 */
export function sessionCookieName(config: Config): string {
  return config.COOKIE_SECURE ? '__Host-zh_session' : 'zh_session';
}

/** Lê um cookie do cabeçalho bruto (sem decodificar: o token é base64url). */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}
