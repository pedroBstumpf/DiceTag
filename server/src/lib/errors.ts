import { z } from 'zod';

/**
 * Erros de requisição com status HTTP e mensagem SEGURA para o cliente (sem detalhes internos).
 * Erros inesperados viram "Erro interno." no tratador global (`app.ts`) e só aparecem no log.
 */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    /** Detalhes seguros de validação (caminho + mensagem), nunca valores recebidos. */
    readonly details?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

export const badRequest = (message = 'Requisição inválida.') => new HttpError(400, message);
export const unauthorized = (message = 'Faça login para continuar.') => new HttpError(401, message);
export const forbidden = (message = 'Você não tem permissão para isso.') => new HttpError(403, message);
/** Também usado para recursos de outras contas: não revela que o recurso existe. */
export const notFound = (message = 'Não encontrado.') => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);

/** Valida `data` com o esquema; inválido = 400 com a lista de campos (sem ecoar os valores). */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  throw new HttpError(
    400,
    'Dados inválidos.',
    result.error.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message })),
  );
}
