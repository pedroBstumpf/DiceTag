/** Usuário público (o que a interface conhece). */
export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: number;
}

/** Registro armazenado localmente (inclui o hash da senha). */
export interface StoredUser extends User {
  passwordHash: string;
}
