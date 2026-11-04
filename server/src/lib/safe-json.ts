import { RESERVED_KEYS } from './ids';

/**
 * Conferência de JSON vindo do cliente (comandos da mesa, itens do mundo) antes de guardar.
 *
 * Protege contra:
 * - prototype pollution: chaves `__proto__`, `constructor`, `prototype`;
 * - estruturas que travam o servidor: profundidade, quantidade de nós e textos enormes;
 * - tipos que não são JSON puro (funções, `undefined` em arrays, números infinitos).
 *
 * Os esquemas zod validam o formato conhecido; isto é a rede de segurança para as partes
 * livres (fichas, conteúdo de documentos) que o servidor guarda sem interpretar.
 */

export interface JsonLimits {
  maxDepth: number;
  maxNodes: number;
  maxStringLength: number;
}

export const DEFAULT_JSON_LIMITS: JsonLimits = { maxDepth: 32, maxNodes: 50_000, maxStringLength: 1_000_000 };

/** Devolve o motivo da recusa, ou null se o valor é JSON seguro dentro dos limites. */
export function unsafeJsonReason(value: unknown, limits: JsonLimits = DEFAULT_JSON_LIMITS): string | null {
  let nodes = 0;
  // Pilha explícita (sem recursão): estrutura profunda não estoura a pilha do Node
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  while (stack.length) {
    const { value: v, depth } = stack.pop()!;
    if (++nodes > limits.maxNodes) return 'dados grandes demais';
    if (depth > limits.maxDepth) return 'estrutura profunda demais';
    if (v === null || typeof v === 'boolean') continue;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return 'número inválido';
      continue;
    }
    if (typeof v === 'string') {
      if (v.length > limits.maxStringLength) return 'texto grande demais';
      continue;
    }
    if (Array.isArray(v)) {
      for (const item of v) stack.push({ value: item, depth: depth + 1 });
      continue;
    }
    if (typeof v === 'object') {
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) return 'objeto inválido';
      for (const key of Object.keys(v)) {
        if (RESERVED_KEYS.has(key)) return 'chave proibida';
        if (key.length > 200) return 'chave grande demais';
        stack.push({ value: (v as Record<string, unknown>)[key], depth: depth + 1 });
      }
      continue;
    }
    return 'tipo inválido';
  }
  return null;
}

/**
 * `JSON.parse` que recusa chaves de protótipo (como o `secure-json-parse` do Fastify faz no HTTP).
 * Usado nas mensagens do WebSocket. Lança erro se o texto não é JSON ou tem chave proibida.
 */
export function parseJsonSafely(text: string): unknown {
  return JSON.parse(text, (key, value) => {
    if (RESERVED_KEYS.has(key)) throw new SyntaxError('chave proibida');
    return value;
  });
}
