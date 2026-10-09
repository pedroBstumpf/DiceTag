import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { WORLD_ITEM_META, WorldItem, WorldItemType } from '../../../../core/models/world-item.model';
import { MAX_WORLDS } from '../../../../core/models/world.model';
import { WorldsService } from '../../../../core/services/worlds.service';
import { AutoFocus } from '../../../../shared/directives/auto-focus.directive';
import { WorldbuildService, byTreeOrder } from '../../services/worldbuild.service';

/** Abas do explorador: árvore de arquivos ou a lista de um tipo de item. */
type ExplorerView = 'files' | Exclude<WorldItemType, 'folder'>;

/** Aba de lista: tipo listado, textos e o que o botão "Novo" faz. */
interface ListView {
  id: ExplorerView;
  label: string;
  newLabel: string;
  empty: string;
}

/** Abas de lista, na ordem da barra (a árvore "Arquivos" vem antes). */
const LIST_VIEWS: ListView[] = [
  { id: 'item', label: 'Itens', newLabel: 'Novo item', empty: 'Nenhum item ainda. Cada item tem um cartão com imagem, nome e etiquetas.' },
  { id: 'npc', label: 'NPCs', newLabel: 'Novo NPC', empty: 'Nenhum NPC ainda. As fichas daqui são a base dos NPCs das mesas.' },
  { id: 'race', label: 'Raças', newLabel: 'Nova raça', empty: 'Nenhuma raça ainda. Escolhida na ficha, a raça soma etiquetas e modificadores de status.' },
  { id: 'timeline', label: 'Linhas do tempo', newLabel: 'Nova linha do tempo', empty: 'Nenhuma linha do tempo ainda.' },
  { id: 'document', label: 'Documentos', newLabel: 'Novo documento', empty: 'Nenhum documento ainda.' },
  { id: 'image', label: 'Mapas', newLabel: 'Enviar mapa / imagem', empty: 'Nenhum mapa ainda. Envie imagens ou solte arquivos na árvore.' },
];

/**
 * Explorador do worldbuild: árvore de pastas e itens.
 *
 * - Abas (ícones): Arquivos (árvore) e uma lista por tipo — Itens, NPCs (bestiário), Raças,
 *   Linhas do tempo, Documentos e Mapas —, cada uma com busca e botão "Novo"
 * - Criar itens na raiz ou dentro de pastas
 * - Renomear (duplo clique ou menu), excluir, mover
 * - Arrastar itens para dentro de pastas (ou para a raiz)
 * - Soltar arquivos de imagem do computador em qualquer pasta
 * - Buscar por nome
 *
 * Também é a aba Lore da mesa: o mestre edita o mundo direto dali e revela pastas aos
 * jogadores (`revealed`); o jogador vê só as pastas reveladas (`visible`), em só leitura.
 */
@Component({
  selector: 'app-explorer',
  imports: [NgTemplateOutlet, AutoFocus, MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule],
  templateUrl: './explorer.html',
  host: { class: 'flex h-full flex-col' },
})
export class Explorer {
  readonly service = inject(WorldbuildService);
  private readonly snackBar = inject(MatSnackBar);

  readonly meta = WORLD_ITEM_META;

  /** Ícone/cor de um item (tipado para uso nos templates). */
  metaOf(item: WorldItem) {
    return WORLD_ITEM_META[item.type];
  }

  // --- Saídas --------------------------------------------------------------
  /** Pedido para abrir um item numa janela. */
  readonly opened = output<string>();
  /** Itens removidos (para fechar janelas abertas). */
  readonly removed = output<string[]>();
  /** Pedido para esconder o painel. */
  readonly hide = output<void>();
  /** Mostra o botão "Esconder painel" (falso quando o explorador está numa janela, ex.: na mesa). */
  readonly hideable = input(true);
  /** Mostra o seletor de mundos no cabeçalho (página do Worldbuild; na mesa o mundo é o da mesa). */
  readonly worldSwitcher = input(false);
  /** Pastas podem abrir como janela na mesa de trabalho (página do Worldbuild). */
  readonly folderWindows = input(false);

  // --- Aba Lore da mesa ----------------------------------------------------
  /** Só leitura (jogador na mesa): sem criar, renomear, mover nem excluir. */
  readonly readonly = input(false);
  /**
   * Filtro de itens visíveis (jogador na mesa: só o que está em pastas reveladas). Deve ser
   * fechado para baixo: se uma pasta é visível, tudo dentro dela também é. null = tudo.
   */
  readonly visible = input<((id: string) => boolean) | null>(null);
  /** Pastas reveladas aos jogadores (mestre na mesa): mostra o "olho" nas pastas. null = sem olho. */
  readonly revealed = input<ReadonlySet<string> | null>(null);
  /** Clique no "olho" de uma pasta. */
  readonly revealToggled = output<string>();

  /** Estado do "olho" de uma pasta: revelada, visível por uma pasta acima ou escondida. */
  revealOf(item: WorldItem): 'revealed' | 'inherited' | 'hidden' {
    const shown = this.revealed();
    if (!shown) return 'hidden';
    if (shown.has(item.id)) return 'revealed';
    const byId = this.service.byId();
    const seen = new Set<string>();
    for (let id = item.parentId; id && !seen.has(id); id = byId.get(id)?.parentId ?? null) {
      if (shown.has(id)) return 'inherited';
      seen.add(id);
    }
    return 'hidden';
  }

  /** Itens que passam pelo filtro `visible`. */
  private readonly visibleItems = computed(() => {
    const visible = this.visible();
    const items = this.service.items();
    return visible ? items.filter((i) => visible(i.id)) : items;
  });

  /** Raiz da árvore com filtro: itens visíveis cuja pasta não é visível (pastas reveladas soltas). */
  private readonly visibleRoots = computed(() => {
    const visible = this.visible();
    if (!visible) return [];
    return this.visibleItems()
      .filter((i) => !i.parentId || !visible(i.parentId))
      .sort(byTreeOrder);
  });

  /** Filhos de uma pasta na árvore (null = raiz), respeitando o filtro. */
  childrenOf(parentId: string | null): WorldItem[] {
    const visible = this.visible();
    if (!visible) return this.service.childrenOf(parentId);
    return parentId ? this.service.childrenOf(parentId).filter((i) => visible(i.id)) : this.visibleRoots();
  }

  // --- Mundos --------------------------------------------------------------
  readonly worlds = inject(WorldsService);
  readonly maxWorlds = MAX_WORLDS;
  readonly renamingWorld = signal(false);

  createWorld(): void {
    void this.worlds.create();
  }

  finishWorldRename(value: string): void {
    if (!this.renamingWorld()) return;
    const id = this.worlds.activeId();
    void this.worlds.rename(id, value);
    this.renamingWorld.set(false);
  }

  /** Exclui o mundo aberto (com confirmação; só se nenhuma mesa se passa nele). */
  async removeWorld(): Promise<void> {
    const world = this.worlds.active();
    if (!world || !confirm(`Excluir o mundo "${world.name}" e todos os itens dele? Isso não pode ser desfeito.`)) return;
    const error = await this.worlds.remove(world.id);
    this.snackBar.open(error ?? `Mundo "${world.name}" excluído.`);
  }

  // --- Abas ----------------------------------------------------------------
  readonly views: { id: ExplorerView; icon: string; label: string }[] = [
    { id: 'files', icon: 'folder', label: 'Arquivos' },
    ...LIST_VIEWS.map((v) => ({ id: v.id, icon: WORLD_ITEM_META[v.id as WorldItemType].icon, label: v.label })),
  ];
  readonly view = signal<ExplorerView>('files');
  /** Aba de lista aberta (null = árvore de arquivos). */
  readonly listView = computed(() => LIST_VIEWS.find((v) => v.id === this.view()) ?? null);

  /** Itens de cada tipo, em ordem alfabética (uma passada pela lista). */
  private readonly byType = computed(() => {
    const map = new Map<string, WorldItem[]>();
    for (const item of this.visibleItems()) map.set(item.type, [...(map.get(item.type) ?? []), item]);
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }));
    return map;
  });

  /** Itens do tipo da aba aberta, filtrados pela busca. */
  readonly itemResults = computed(() => {
    const q = this.query().trim().toLowerCase();
    const items = this.byType().get(this.view()) ?? [];
    return q ? items.filter((i) => i.name.toLowerCase().includes(q)) : items;
  });

  /** Quantos itens há na aba (contador; null = árvore). */
  countOf(view: ExplorerView): number | null {
    return view === 'files' ? null : (this.byType().get(view)?.length ?? 0);
  }

  /** Botão "Novo" da aba de lista: cria o tipo da aba (Mapas: envia imagens). */
  createInView(view: ListView, fileInput: HTMLInputElement): void {
    if (view.id === 'image') this.pickImages(fileInput);
    else this.create(view.id as WorldItemType);
  }

  // --- Estado da árvore ----------------------------------------------------
  readonly expanded = signal(new Set<string>());
  readonly renamingId = signal<string | null>(null);
  readonly dropTargetId = signal<string | null | undefined>(undefined);
  readonly query = signal('');

  /** Resultado da busca (lista plana) quando há texto digitado. */
  readonly searchResults = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return null;
    return this.visibleItems().filter((i) => i.name.toLowerCase().includes(q));
  });

  private draggedId: string | null = null;
  private uploadParentId: string | null = null;

  // --- Criação -------------------------------------------------------------

  /** Cria um item, já abre para edição do nome e (se não for pasta) abre a janela. */
  create(type: WorldItemType, parentId: string | null = null): void {
    const item = this.service.create(type, parentId);
    if (parentId) this.setExpanded(parentId, true);
    this.renamingId.set(item.id);
    if (type !== 'folder') this.opened.emit(item.id);
  }

  /** Abre o seletor de imagens para enviar à pasta indicada. */
  pickImages(input: HTMLInputElement, parentId: string | null = null): void {
    this.uploadParentId = parentId;
    input.click();
  }

  async onFilesPicked(input: HTMLInputElement): Promise<void> {
    await this.uploadFiles(Array.from(input.files ?? []), this.uploadParentId);
    input.value = '';
  }

  // --- Interação com itens -------------------------------------------------

  /** Clique: pastas abrem/fecham, demais itens abrem em janela. */
  activate(item: WorldItem): void {
    if (this.renamingId() === item.id) return;
    if (item.type === 'folder') this.toggle(item.id);
    else this.opened.emit(item.id);
  }

  toggle(id: string): void {
    this.setExpanded(id, !this.expanded().has(id));
  }

  finishRename(item: WorldItem, value: string): void {
    if (this.renamingId() !== item.id) return;
    this.service.rename(item.id, value);
    this.renamingId.set(null);
  }

  remove(item: WorldItem): void {
    const label = item.type === 'folder' ? `a pasta "${item.name}" e todo o seu conteúdo` : `"${item.name}"`;
    if (!confirm(`Excluir ${label}?`)) return;
    this.removed.emit(this.service.remove(item.id));
  }

  moveToRoot(item: WorldItem): void {
    this.service.move(item.id, null);
  }

  // --- Arrastar e soltar ---------------------------------------------------

  onDragStart(event: DragEvent, item: WorldItem): void {
    if (this.readonly()) return;
    this.draggedId = item.id;
    event.dataTransfer?.setData('text/plain', item.name);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  onDragEnd(): void {
    this.draggedId = null;
    this.dropTargetId.set(undefined);
  }

  /** Permite soltar sobre pastas (targetId) ou na raiz (null). */
  onDragOver(event: DragEvent, targetId: string | null): void {
    const hasFiles = event.dataTransfer?.types.includes('Files');
    if (this.readonly() || (!this.draggedId && !hasFiles)) return;
    event.preventDefault();
    event.stopPropagation();
    this.dropTargetId.set(targetId);
  }

  async onDrop(event: DragEvent, targetId: string | null): Promise<void> {
    if (this.readonly()) return;
    event.preventDefault();
    event.stopPropagation();
    this.dropTargetId.set(undefined);

    // Arquivos vindos do computador
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length) {
      await this.uploadFiles(files, targetId);
      return;
    }

    // Item interno sendo movido
    if (this.draggedId && this.service.move(this.draggedId, targetId) && targetId) {
      this.setExpanded(targetId, true);
    }
    this.draggedId = null;
  }

  // --- Internos ------------------------------------------------------------

  private async uploadFiles(files: File[], parentId: string | null): Promise<void> {
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (images.length < files.length) this.snackBar.open('Apenas arquivos de imagem são aceitos.');

    for (const file of images) {
      const item = await this.service.uploadImage(file, parentId);
      this.opened.emit(item.id);
    }
    if (parentId) this.setExpanded(parentId, true);
  }

  private setExpanded(id: string, open: boolean): void {
    this.expanded.update((set) => {
      const next = new Set(set);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  }
}
