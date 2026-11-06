/**
 * Nome de entrada do convidado: o mesmo nome que aparece na mesa, comparado sem maiúsculas, acentos
 * e espaços repetidos ("Lyra", "lyra" e " Lýra " são o mesmo). Guardado em `users.login_name`, com
 * índice único, só para convidados com senha.
 */

/** Forma normalizada do nome (a que vai para o banco e é comparada no login). */
export function loginNameOf(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Nome que um convidado pode usar para entrar: não vazio e sem `@` (o `@` indica o e-mail do dono). */
export function validGuestName(name: string): boolean {
  return loginNameOf(name).length > 0 && !name.includes('@');
}
