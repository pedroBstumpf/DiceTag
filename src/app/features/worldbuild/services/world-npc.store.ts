import { Injectable, inject } from '@angular/core';
import { Tag } from '../../../core/models/tag.model';
import { CharacterSheet, TokenBar, withStatusBars } from '../../../core/models/table-session.model';
import { WorldItem, npcSheetOf, npcTokenOf } from '../../../core/models/world-item.model';
import { SheetData, SheetStore } from '../../../core/services/sheet-store';
import { WorldbuildService } from './worldbuild.service';

/**
 * Fichas base dos NPCs do bestiário (itens `npc` do mundo aberto), lidas e gravadas no
 * WorldbuildService. Usada pela ficha no Worldbuild e nas janelas do bestiário na mesa.
 * Fornecida pela diretiva `appWorldNpcSheet`.
 */
@Injectable()
export class WorldNpcStore extends SheetStore {
  private readonly service = inject(WorldbuildService);

  constructor() {
    super();
    // Imagens do inventário no mesmo lugar do mundo aberto (navegador ou servidor)
    this.files = this.service.fileStore;
  }

  sheetData(id: string): SheetData | null {
    const item = this.npc(id);
    if (!item) return null;
    const token = npcTokenOf(item);
    return { id, kind: 'npc', level: 'world', name: item.name, blobId: token.blobId, sheet: npcSheetOf(item), bars: token.bars, tags: token.tags };
  }

  renameSheet(id: string, name: string): void {
    this.service.rename(id, name);
  }

  async setSheetImage(id: string, file: File): Promise<void> {
    const item = this.npc(id);
    if (!item) return;
    const old = item.token?.blobId;
    const blobId = await this.service.storeBlob(file);
    // Relê depois do await (o token pode ter mudado no meio)
    const current = this.npc(id);
    if (current) this.service.update(id, { token: { ...npcTokenOf(current), blobId } });
    if (old) this.service.deleteBlob(old);
  }

  updateSheet(id: string, patch: Partial<CharacterSheet>): void {
    const item = this.npc(id);
    if (item) this.service.update(id, { sheet: { ...npcSheetOf(item), ...patch } });
  }

  updateStatus(id: string, patch: { bars?: TokenBar[]; tags?: Tag[] }): void {
    const item = this.npc(id);
    if (!item) return;
    const token = { ...npcTokenOf(item), ...patch };
    this.service.update(id, { token: { ...token, bars: withStatusBars(token.bars) } });
  }

  private npc(id: string): WorldItem | undefined {
    const item = this.service.byId().get(id);
    return item?.type === 'npc' ? item : undefined;
  }
}
