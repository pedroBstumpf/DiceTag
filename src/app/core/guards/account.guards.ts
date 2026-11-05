import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ServerAccountService } from '../services/server-account.service';

/**
 * O app é só por convite: sem uma conta do servidor, tudo leva à página de entrada.
 *
 * Servidor fora do ar (só em desenvolvimento, com o `ng serve` sem o servidor; o app publicado vem
 * do próprio servidor) não bloqueia as telas que funcionam só no navegador. Estas proteções só
 * organizam a tela: quem decide o que cada conta pode fazer é o servidor.
 */
export const accountGuard: CanActivateFn = async () => {
  const account = inject(ServerAccountService);
  const router = inject(Router);
  await account.ensureChecked();
  return account.user() || account.error() ? true : router.createUrlTree(['/entrar']);
};

/** Páginas do dono do app: o convidado vai para as mesas dele. */
export const ownerGuard: CanActivateFn = async () => {
  const account = inject(ServerAccountService);
  const router = inject(Router);
  await account.ensureChecked();
  if (account.isOwner() || (!account.user() && account.error())) return true;
  return router.createUrlTree([account.user() ? '/mesas' : '/entrar']);
};
