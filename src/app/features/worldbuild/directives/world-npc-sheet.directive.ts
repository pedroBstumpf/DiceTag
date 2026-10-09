import { Directive } from '@angular/core';
import { SheetStore } from '../../../core/services/sheet-store';
import { WorldNpcStore } from '../services/world-npc.store';

/**
 * Faz a ficha onde é aplicada ler e gravar a ficha base de um NPC do bestiário:
 * `<app-character-sheet appWorldNpcSheet [sheetId]="item.id" />` (NPCs do mundo aberto).
 */
@Directive({
  selector: '[appWorldNpcSheet]',
  providers: [WorldNpcStore, { provide: SheetStore, useExisting: WorldNpcStore }],
})
export class WorldNpcSheet {}
