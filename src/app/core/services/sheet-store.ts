import { Injectable, inject } from '@angular/core';
import { Tag } from '../models/tag.model';
import { CharacterSheet, InventoryEntry, TableEntry, TokenBar } from '../models/table-session.model';
import { FileStore, LocalFileStore } from './file-store';

/**
 * Onde a ficha exibida mora:
 * - `character`: personagem da mesa (ficha e token vinculados na própria entrada);
 * - `npc`: NPC da mesa com os dados na própria entrada (NPCs criados antes do bestiário);
 * - `npc-base`: NPC da mesa que é referência a um NPC do Worldbuild (edita a ficha base);
 * - `npc-token`: cópia individual de um NPC colocado no mapa;
 * - `world`: NPC do Worldbuild aberto fora da mesa (bestiário).
 */
export type SheetLevel = 'character' | 'npc' | 'npc-base' | 'npc-token' | 'world';

/** Tudo o que a ficha exibe, já com os valores padrão aplicados. */
export interface SheetData {
  id: string;
  kind: 'character' | 'npc';
  level: SheetLevel;
  name: string;
  /** Imagem (a mesma do token). */
  blobId?: string;
  sheet: CharacterSheet;
  /** Barras do token (inclui Corpo, Mente e Espírito). */
  bars: TokenBar[];
  /** Etiquetas do token. */
  tags: Tag[];
  /** Entrada da mesa dona das ações e das permissões (ausente fora da mesa). */
  entry?: TableEntry;
}

/**
 * Fonte de dados da ficha (personagem e NPC). A mesma tela de ficha funciona na mesa
 * (TableSessionService) e no Worldbuild (WorldNpcStore): cada uma diz como ler e
 * gravar pelo id da ficha. As operações de inventário são as mesmas para todas.
 *
 * Fornecida por quem exibe a ficha: `{ provide: SheetStore, useExisting: ... }`.
 */
@Injectable()
export abstract class SheetStore {
  /** Onde ficam as imagens (do inventário e da ficha): o navegador; a mesa online troca pelo servidor. */
  protected files: FileStore = inject(LocalFileStore);

  /** Dados da ficha `id` (null se não existir). Lê signals: use dentro de computed. */
  abstract sheetData(id: string): SheetData | null;
  abstract renameSheet(id: string, name: string): void;
  /** Troca a imagem da ficha (a mesma do token) e apaga a anterior. */
  abstract setSheetImage(id: string, file: File): Promise<void>;
  abstract updateSheet(id: string, patch: Partial<CharacterSheet>): void;
  /** Barras e etiquetas do token da ficha (as barras de status são sempre mantidas). */
  abstract updateStatus(id: string, patch: { bars?: TokenBar[]; tags?: Tag[] }): void;

  // --- Inventário (cópias dos itens por ficha) -----------------------------

  /** Itens do inventário da ficha. */
  inventoryOf(id: string): InventoryEntry[] {
    return this.sheetData(id)?.sheet.inventory ?? [];
  }

  /** Personaliza o item só neste inventário (nome/etiquetas/preço/quantidade/equipado; o original não muda). */
  updateInventoryItem(
    id: string,
    inventoryId: string,
    patch: Pick<InventoryEntry, 'name' | 'tags' | 'description' | 'price' | 'quantity' | 'equipped'>,
  ): void {
    this.updateSheet(id, { inventory: this.inventoryOf(id).map((i) => (i.id === inventoryId ? { ...i, ...patch } : i)) });
  }

  /** Troca a imagem do item só neste inventário (apaga a personalizada anterior). */
  async setInventoryImage(id: string, inventoryId: string, file: File): Promise<void> {
    const old = this.inventoryOf(id).find((i) => i.id === inventoryId)?.blobId;
    const blobId = await this.uploadFile(file);
    if (!blobId) return;
    this.updateSheet(id, { inventory: this.inventoryOf(id).map((i) => (i.id === inventoryId ? { ...i, blobId } : i)) });
    if (old) void this.files.remove(old);
  }

  /** Volta o item ao original (descarta nome, etiquetas, descrição e imagem personalizados; mantém preço e quantidade). */
  resetInventoryItem(id: string, inventoryId: string): void {
    const item = this.inventoryOf(id).find((i) => i.id === inventoryId);
    if (!item) return;
    const { name: _name, tags: _tags, blobId: _blobId, description: _description, ...kept } = item;
    this.updateSheet(id, { inventory: this.inventoryOf(id).map((i) => (i.id === inventoryId ? kept : i)) });
    if (item.blobId) void this.files.remove(item.blobId);
  }

  /** Tira o item do inventário (e apaga a imagem personalizada, se houver). */
  removeInventoryItem(id: string, inventoryId: string): void {
    const item = this.inventoryOf(id).find((i) => i.id === inventoryId);
    this.updateSheet(id, { inventory: this.inventoryOf(id).filter((i) => i.id !== inventoryId) });
    if (item?.blobId) void this.files.remove(item.blobId);
  }

  /** Duplica as imagens personalizadas de um inventário (para uma cópia não apagar as da outra). */
  protected async cloneInventoryBlobs(inventory: InventoryEntry[]): Promise<InventoryEntry[]> {
    return Promise.all(
      inventory.map(async (item) => {
        if (!item.blobId) return item;
        const blobId = await this.files.copy(item.blobId).catch(() => undefined);
        return { ...item, blobId };
      }),
    );
  }

  /** Apaga as imagens personalizadas de um inventário (ficha excluída). */
  protected deleteInventoryBlobs(inventory: InventoryEntry[] | undefined): void {
    for (const item of inventory ?? []) {
      if (item.blobId) void this.files.remove(item.blobId);
    }
  }

  // --- Arquivos --------------------------------------------------------------

  /** Guarda um arquivo enviado pelo usuário; null = não deu (o motivo vai para `uploadFailed`). */
  protected async uploadFile(file: Blob): Promise<string | null> {
    try {
      return await this.files.put(file);
    } catch (error) {
      this.uploadFailed(error);
      return null;
    }
  }

  /** Envio recusado (ex.: servidor sem espaço ou tipo de arquivo não aceito). Quem exibe pode avisar. */
  protected uploadFailed(error: unknown): void {
    console.error('Arquivo não guardado:', error);
  }
}
