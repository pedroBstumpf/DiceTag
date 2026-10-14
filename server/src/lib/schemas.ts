import { z } from 'zod';

/**
 * Esquemas de entrada reutilizados pelas rotas: textos com limite de tamanho e sem caracteres
 * de controle (quebram logs e interfaces), e-mail normalizado.
 */

/** Remove caracteres de controle (exceto quebra de linha e tab, se `multiline`). */
function stripControl(value: string, multiline: boolean): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(multiline ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, '');
}

/** Texto de uma linha: sem controle, aparado, entre `min` e `max` caracteres. */
export const text = (min: number, max: number) =>
  z
    .string()
    .max(max * 4)
    .transform((v) => stripControl(v, false).normalize('NFC').trim())
    .pipe(z.string().min(min, min === 1 ? 'obrigatório' : `mínimo de ${min} caracteres`).max(max, `máximo de ${max} caracteres`));

/** Texto de várias linhas. */
export const multilineText = (max: number) =>
  z
    .string()
    .max(max * 4)
    .transform((v) => stripControl(v, true).normalize('NFC').trim())
    .pipe(z.string().max(max, `máximo de ${max} caracteres`));

/** E-mail em minúsculas, sem espaços (é a chave única da conta). */
export const email = z
  .string()
  .max(254)
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.email('e-mail inválido').max(254));

/** Senha recebida: só limite de tamanho aqui (a política completa fica em `passwordProblem`). */
export const passwordInput = z.string().min(1).max(512);
