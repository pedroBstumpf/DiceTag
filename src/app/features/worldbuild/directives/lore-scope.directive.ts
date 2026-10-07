import { Directive } from '@angular/core';
import { LoreService } from '../services/lore.service';
import { WorldbuildService } from '../services/worldbuild.service';

/**
 * Faz o componente onde é aplicada (e os filhos dele) usar a Lore geral
 * no lugar do worldbuild do usuário. Usada na mesa para abrir itens da
 * Lore geral com os mesmos editores: `<app-document-editor appLoreScope … />`.
 */
@Directive({
  selector: '[appLoreScope]',
  providers: [{ provide: WorldbuildService, useExisting: LoreService }],
})
export class LoreScope {}
