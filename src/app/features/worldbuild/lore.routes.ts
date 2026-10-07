import { Routes } from '@angular/router';
import { LoreService } from './services/lore.service';
import { WorldbuildService } from './services/worldbuild.service';
import { Worldbuild } from './worldbuild';

/**
 * Rota da Lore geral (/lore): a mesma página do Worldbuild, mas com o
 * LoreService (dados globais) no lugar do worldbuild do usuário.
 * Fica num arquivo próprio para continuar carregando sob demanda.
 */
export const LORE_ROUTES: Routes = [
  {
    path: '',
    component: Worldbuild,
    providers: [{ provide: WorldbuildService, useExisting: LoreService }],
  },
];
