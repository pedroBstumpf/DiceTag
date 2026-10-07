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
        title: 'DiceTag — Início',
        loadComponent: () => import('./features/home/home').then((m) => m.Home),
      },
      {
        path: 'mesas',
        title: 'DiceTag — Minhas mesas',
        loadComponent: () => import('./features/tables/tables').then((m) => m.Tables),
      },
      {
        path: 'worldbuild',
        title: 'DiceTag — Worldbuild',
        loadComponent: () => import('./features/worldbuild/worldbuild').then((m) => m.Worldbuild),
      },
      {
        // Lore geral do mundo: mesma página do worldbuild, com dados globais
        path: 'lore',
        title: 'DiceTag — Lore geral',
        loadChildren: () => import('./features/worldbuild/lore.routes').then((m) => m.LORE_ROUTES),
      },
    ],
  },
  {
    // Mesa de jogo: tela cheia, fora do Shell, para máxima imersão
    path: 'mesa/:id',
    title: 'DiceTag — Mesa',
    loadComponent: () => import('./features/game-table/game-table').then((m) => m.GameTablePage),
  },
  { path: '**', redirectTo: '' },
];
