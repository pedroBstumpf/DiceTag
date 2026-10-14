import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/**
 * Identificadores. O servidor gera os seus com `randomUUID` (criptograficamente aleatório,
 * impossível de adivinhar). Ids vindos do cliente (comandos da mesa, itens do mundo) passam por
 * `idSchema`: só letras, números, `-` e `_`, até 64 caracteres — nada que forme caminho de
 * arquivo ou HTML — e nunca um nome reservado de objeto (`__proto__`, `constructor`…).
 */

export const newId = (): string => randomUUID();

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Nomes que, usados como chave de objeto, alteram o protótipo (prototype pollution). */
export const RESERVED_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

export const isSafeId = (value: string): boolean => ID_PATTERN.test(value) && !RESERVED_KEYS.has(value);

export const idSchema = z.string().refine(isSafeId, 'id inválido');
