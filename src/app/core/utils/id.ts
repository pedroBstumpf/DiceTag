/**
 * Gera um identificador único.
 * Usa crypto.randomUUID quando disponível; o fallback cobre acessos
 * por HTTP fora de localhost (ex.: testar no celular pela rede local).
 */
export const newId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
