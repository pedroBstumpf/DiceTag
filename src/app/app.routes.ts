import { Routes } from '@angular/router';
import { accountGuard, ownerGuard } from './core/guards/account.guards';
import { Shell } from './layout/shell/shell';

/**
 * Rotas da aplicação. O app é só por convite: sem conta, tudo leva a `entrar`, e as únicas páginas
 * abertas são a de entrada, a do convite e a de redefinir a senha. Convidados veem só as mesas deles.
 * As páginas ficam dentro do Shell (barra lateral + área de conteúdo), exceto a mesa de jogo, que
 * ocupa a tela inteira. Tudo é carregado sob demanda (lazy loading) para manter o app leve.
 */
export const routes: Routes = [
  {
    path: 'entrar',
    title: 'Zehenia — Entrar',
    loadComponent: () => import('./features/auth/sign-in/sign-in').then((m) => m.SignIn),
  },
  {
    // Aberta pelo link que o mestre envia
    path: 'convite',
    title: 'Zehenia — Convite',
    loadComponent: () => import('./features/auth/invite/invite').then((m) => m.Invite),
  },
  {
    // Aberta pelo link de recuperação de senha
    path: 'redefinir-senha',
    title: 'Zehenia — Redefinir a senha',
    loadComponent: () => import('./features/auth/reset-password/reset-password').then((m) => m.ResetPassword),
  },
  {
    path: '',
    component: Shell,
    canActivate: [accountGuard],
    children: [
      {
        path: '',
        title: 'Zehenia — Início',
        canActivate: [ownerGuard],
        loadComponent: () => import('./features/home/home').then((m) => m.Home),
      },
      {
        path: 'mesas',
        title: 'Zehenia — Minhas mesas',
        loadComponent: () => import('./features/tables/tables').then((m) => m.Tables),
      },
      {
        path: 'arquivos',
        title: 'Zehenia — Arquivos',
        canActivate: [ownerGuard],
        loadComponent: () => import('./features/library/library').then((m) => m.Library),
      },
      {
        path: 'worldbuild',
        title: 'Zehenia — Worldbuild',
        canActivate: [ownerGuard],
        loadComponent: () => import('./features/worldbuild/worldbuild').then((m) => m.Worldbuild),
      },
    ],
  },
  {
    // Mesa de jogo: tela cheia, fora do Shell, para máxima imersão
    path: 'mesa/:id',
    title: 'Zehenia — Mesa',
    canActivate: [ownerGuard],
    loadComponent: () => import('./features/game-table/game-table').then((m) => m.GameTablePage),
  },
  {
    // Mesa online: a mesma tela, ligada à sala da mesa no servidor (input `online`)
    path: 'mesa-online/:id',
    title: 'Zehenia — Mesa online',
    canActivate: [accountGuard],
    data: { online: true },
    loadComponent: () => import('./features/game-table/game-table').then((m) => m.GameTablePage),
  },
  { path: '**', redirectTo: '' },
];
