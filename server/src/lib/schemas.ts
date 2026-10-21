import { z } from 'zod';
import { PASSWORD_MAX, passwordProblem } from '../security/password';

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

/** Senha digitada no login ou como senha atual: só o tamanho (a política vale para senhas novas). */
export const passwordInput = z.string().min(1).max(PASSWORD_MAX);

/**
 * Senha nova (cadastro, troca): a política inteira no zod (BACKEND_SECURITY.md §1) — de 8 a 128
 * caracteres, espaços e Unicode aceitos, sem as senhas mais comuns nem um caractere repetido.
 * A comparação com o e-mail fica no objeto que tem os dois (`withPasswordPolicy`).
 */
export const newPassword = z.string().superRefine((value, ctx) => {
  const problem = passwordProblem(value, '');
  if (problem) ctx.addIssue({ code: 'custom', message: problem });
});

/** Cadastro: a senha também não pode ser o e-mail (nem a parte antes do @). */
export function withPasswordPolicy<T extends z.ZodType<{ email: string; password: string }>>(schema: T) {
  return schema.superRefine((body, ctx) => {
    const problem = passwordProblem(body.password, body.email);
    if (problem) ctx.addIssue({ code: 'custom', path: ['password'], message: problem });
  });
}
