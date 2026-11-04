import { Routes } from '@angular/router';
import { Shell } from './layout/shell/shell';

/**
 * Rotas da aplicação.
 * As páginas ficam dentro do Shell (barra lateral + área de conteúdo),
 * exceto a mesa de jogo, que ocupa a tela inteira.
 * Tudo é carregado sob demanda (lazy loading) para manter o app leve.
 */
export const routes: Routes = [
  {
    path: '',
    component: Shell,
    children: [
      {
        path: '',
        title: 'Zehenia — Início',
        loadComponent: () => import('./features/home/home').then((m) => m.Home),
      },
      {
        path: 'mesas',
        title: 'Zehenia — Minhas mesas',
        loadComponent: () => import('./features/tables/tables').then((m) => m.Tables),
      },
      {
        path: 'worldbuild',
        title: 'Zehenia — Worldbuild',
        loadComponent: () => import('./features/worldbuild/worldbuild').then((m) => m.Worldbuild),
      },
      {
        // Aberta pelo link de recuperação de senha da conta do servidor
        path: 'redefinir-senha',
        title: 'Zehenia — Redefinir a senha',
        loadComponent: () => import('./features/auth/reset-password/reset-password').then((m) => m.ResetPassword),
      },
    ],
  },
  {
    // Mesa de jogo: tela cheia, fora do Shell, para máxima imersão
    path: 'mesa/:id',
    title: 'Zehenia — Mesa',
    loadComponent: () => import('./features/game-table/game-table').then((m) => m.GameTablePage),
  },
  {
    // Mesa online: a mesma tela, ligada à sala da mesa no servidor (input `online`)
    path: 'mesa-online/:id',
    title: 'Zehenia — Mesa online',
    data: { online: true },
    loadComponent: () => import('./features/game-table/game-table').then((m) => m.GameTablePage),
  },
  { path: '**', redirectTo: '' },
];
