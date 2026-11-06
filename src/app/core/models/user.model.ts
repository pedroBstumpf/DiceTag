/** Usuário público (o que a interface conhece). */
export interface User {
  id: string;
  name: string;
  email: string;
  /** Conta do servidor: o dono do app ou um convidado (a conta local não tem). */
  kind?: 'owner' | 'guest';
  createdAt: number;
  /** Conta do servidor com senha? (convidados antigos podem não ter: o menu oferece "Criar senha") */
  hasPassword?: boolean;
}

/** Registro armazenado localmente (inclui o hash da senha). */
export interface StoredUser extends User {
  passwordHash: string;
}
