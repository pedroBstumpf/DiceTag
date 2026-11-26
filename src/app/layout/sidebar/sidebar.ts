import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { ServerAccountService, shortAccountId } from '../../core/services/server-account.service';
import { GameTablesService } from '../../core/services/game-tables.service';
import { OnlineTablesService } from '../../core/services/online-tables.service';
import { TABLE_ACCENTS } from '../../core/models/game-table.model';
import { MAX_WORLDS, World } from '../../core/models/world.model';
import { WORLD_ITEM_META, WorldItemType } from '../../core/models/world-item.model';
import { ServerWorldsService } from '../../core/services/server-worlds.service';
import { WorldsService } from '../../core/services/worlds.service';
import { LayoutService } from '../../core/services/layout.service';
import { AutoFocus } from '../../shared/directives/auto-focus.directive';

/** Quantas mesas aparecem na barra (as demais ficam em "Ver todas"). */
const MAX_SIDEBAR_TABLES = 6;

/** Grupos que abrem e fecham na barra. Quais estão abertos fica lembrado neste navegador. */
type GroupId = 'tables' | 'worldbuild' | 'worlds';
const GROUPS_KEY = 'dicetag.sidebarGroups';
const DEFAULT_GROUPS: Record<GroupId, boolean> = { tables: true, worldbuild: true, worlds: true };

/** Item de navegação (página). */
interface NavLink {
  label: string;
  icon: string;
  route: string;
}

/** Uma mesa na barra: do servidor (mesa online) ou guardada neste navegador. */
interface TableLink {
  id: string;
  name: string;
  accent: string;
  route: string[];
  /** Primeira das mesas deste navegador: recebe o título "Neste navegador". */
  firstLocal: boolean;
}

/** Um mundo na barra lateral: do servidor ou guardado neste navegador. */
interface WorldLink {
  id: string;
  name: string;
  local: boolean;
  /** Primeiro dos mundos deste navegador: recebe o título da seção. */
  firstLocal: boolean;
}

/** Um tipo de item do Worldbuild: abre a aba dele no explorador e cria um novo pelo "+". */
interface WorldbuildType {
  /** Aba do explorador (`?aba=`). */
  view: 'files' | Exclude<WorldItemType, 'folder'>;
  label: string;
  icon: string;
  color: string;
  /** O que o "+" cria (`?novo=`); mapas são enviados como arquivo, então o "+" só abre a aba deles. */
  create: WorldItemType | null;
  createLabel: string;
}

const WORLDBUILD_TYPES: WorldbuildType[] = [
  { view: 'files', label: 'Pastas e arquivos', icon: 'folder', color: WORLD_ITEM_META.folder.color, create: 'folder', createLabel: 'Nova pasta' },
  { view: 'document', label: 'Documentos', icon: WORLD_ITEM_META.document.icon, color: WORLD_ITEM_META.document.color, create: 'document', createLabel: 'Novo documento' },
  { view: 'timeline', label: 'Linhas do tempo', icon: WORLD_ITEM_META.timeline.icon, color: WORLD_ITEM_META.timeline.color, create: 'timeline', createLabel: 'Nova linha do tempo' },
  { view: 'npc', label: 'NPCs', icon: WORLD_ITEM_META.npc.icon, color: WORLD_ITEM_META.npc.color, create: 'npc', createLabel: 'Novo NPC' },
  { view: 'race', label: 'Raças', icon: WORLD_ITEM_META.race.icon, color: WORLD_ITEM_META.race.color, create: 'race', createLabel: 'Nova raça' },
  { view: 'item', label: 'Itens', icon: WORLD_ITEM_META.item.icon, color: WORLD_ITEM_META.item.color, create: 'item', createLabel: 'Novo item' },
  { view: 'image', label: 'Mapas', icon: WORLD_ITEM_META.image.icon, color: WORLD_ITEM_META.image.color, create: null, createLabel: 'Enviar mapa' },
];

/**
 * Barra lateral principal: páginas, três grupos que abrem e fecham — Mesas de jogo (as mesas online e as
 * deste navegador), Worldbuild (os tipos de item do mundo aberto) e Mundos —, cada um com a opção de criar
 * um novo, e a área da conta. Recolhível no desktop (só ícones) e gaveta no mobile.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-sidebar',
  imports: [NgTemplateOutlet, RouterLink, RouterLinkActive, MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule, AutoFocus],
  templateUrl: './sidebar.html',
  host: { class: 'contents' },
})
export class Sidebar {
  readonly layout = inject(LayoutService);
  readonly account = inject(ServerAccountService);
  private readonly tables = inject(GameTablesService);
  private readonly onlineTables = inject(OnlineTablesService);
  private readonly worlds = inject(WorldsService);
  private readonly serverWorlds = inject(ServerWorldsService);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);

  readonly shortId = shortAccountId;
  readonly maxWorlds = MAX_WORLDS;
  readonly worldbuildTypes = WORLDBUILD_TYPES;

  /** Rótulos visíveis? (expandida no desktop ou gaveta aberta no mobile) */
  readonly expanded = computed(() => this.layout.isMobile() || !this.layout.collapsed());

  /** Endereço atual: diz qual mundo está aberto. */
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  /**
   * Vê o que é do dono: a conta do dono ou, sem servidor (só o `ng serve`), quem usa este navegador —
   * a mesma regra do `ownerGuard`. Sem servidor, mesas e mundos são criados neste navegador.
   */
  readonly owner = computed(() => this.account.isOwner() || this.account.localOnly());
  readonly localOnly = this.account.localOnly;

  // --- Páginas -------------------------------------------------------------
  /** Mesas, Worldbuild e Mundos ficam nos grupos abaixo; aqui, só as páginas soltas (do dono). */
  readonly links = computed<NavLink[]>(() =>
    this.owner()
      ? [
          { label: 'Início', icon: 'home', route: '/' },
          { label: 'Arquivos', icon: 'perm_media', route: '/arquivos' },
        ]
      : [],
  );

  // --- Grupos (abrir e fechar) ---------------------------------------------
  readonly openGroups = signal<Record<GroupId, boolean>>(readGroups());

  isOpen(id: GroupId): boolean {
    return this.expanded() && this.openGroups()[id];
  }

  /** Abre ou fecha o grupo. Com a barra recolhida, expande a barra e abre o grupo. */
  toggleGroup(id: GroupId): void {
    if (!this.expanded()) {
      this.layout.collapsed.set(false);
      this.setGroup(id, true);
      return;
    }
    this.setGroup(id, !this.openGroups()[id]);
  }

  private setGroup(id: GroupId, open: boolean): void {
    this.openGroups.update((groups) => ({ ...groups, [id]: open }));
    try {
      localStorage.setItem(GROUPS_KEY, JSON.stringify(this.openGroups()));
    } catch {
      // Sem armazenamento (janela privada): só não lembra da próxima vez
    }
  }

  // --- Criar (nome digitado ali mesmo) ---------------------------------------
  /** Campo de nome aberto: nova mesa ou novo mundo. */
  readonly creating = signal<'table' | 'world' | null>(null);
  readonly draftName = signal('');
  readonly busy = signal(false);

  startCreate(kind: 'table' | 'world'): void {
    this.setGroup(kind === 'table' ? 'tables' : 'worlds', true);
    if (!this.expanded()) this.layout.collapsed.set(false);
    this.draftName.set('');
    this.creating.set(kind);
  }

  /** Ações do "+" dos cabeçalhos (funções, para passar ao template do cabeçalho). */
  readonly startTable = (): void => this.startCreate('table');
  readonly startWorld = (): void => this.startCreate('world');

  cancelCreate(): void {
    this.creating.set(null);
  }

  /** Texto digitado no campo de nome. */
  onDraftInput(event: Event): void {
    this.draftName.set((event.target as HTMLInputElement).value);
  }

  /**
   * Cria a mesa (no mundo que o Worldbuild abriria) ou o mundo: no servidor, com a conta do dono;
   * neste navegador, sem servidor.
   */
  async submitCreate(): Promise<void> {
    const kind = this.creating();
    const name = this.draftName().trim();
    if (!kind || this.busy()) return;
    if (!name) return this.cancelCreate();

    this.busy.set(true);
    try {
      const table = { name, system: 'Sistema próprio', description: '', maxPlayers: 5, accent: TABLE_ACCENTS[0] };
      if (kind === 'table' && this.localOnly()) {
        await this.tables.create({ ...table, worldId: this.worlds.activeId() });
        this.snackBar.open(`Mesa "${name}" criada neste navegador.`);
      } else if (kind === 'table') {
        await this.onlineTables.create({ ...table, worldId: this.serverWorlds.preferred() ?? undefined });
        this.snackBar.open(`Mesa "${name}" criada. Convide os jogadores em Minhas mesas.`);
      } else if (this.localOnly()) {
        const world = await this.worlds.create(name);
        if (!world) throw new Error(`Limite de ${MAX_WORLDS} mundos atingido.`);
        this.snackBar.open(`Mundo "${name}" criado neste navegador.`);
        this.openWorld({ id: world.id, name: world.name, local: true, firstLocal: false });
      } else {
        const world = await this.serverWorlds.create(name);
        this.snackBar.open(`Mundo "${name}" criado.`);
        this.openWorld({ id: world.id, name: world.name, local: false, firstLocal: false });
      }
      this.creating.set(null);
    } catch (e) {
      this.snackBar.open(e instanceof Error ? e.message : 'Algo deu errado.', undefined, { duration: 5000 });
    } finally {
      this.busy.set(false);
    }
  }

  // --- Mesas de jogo -------------------------------------------------------
  /** Mesas online (do servidor) primeiro; depois, para o dono, as guardadas neste navegador. */
  private readonly allTables = computed<TableLink[]>(() => {
    const online = this.onlineTables.tables().map((t) => ({ id: t.id, name: t.name, accent: t.accent, route: ['/mesa-online', t.id], firstLocal: false }));
    const local = this.owner() ? this.tables.tables() : [];
    return [
      ...online,
      ...local.map((t, i) => ({ id: t.id, name: t.name, accent: t.accent, route: ['/mesa', t.id], firstLocal: i === 0 && online.length > 0 })),
    ];
  });
  /** Mesas exibidas na barra (as mais recentes primeiro). */
  readonly tableLinks = computed(() => this.allTables().slice(0, MAX_SIDEBAR_TABLES));
  /** Mesas que não couberam (link "Ver todas"). */
  readonly hiddenTables = computed(() => Math.max(0, this.allTables().length - MAX_SIDEBAR_TABLES));
  readonly tableCount = computed(() => this.allTables().length);
  /** Nome do mundo em que uma mesa nova se passa (o que o Worldbuild abriria). */
  readonly newTableWorld = computed(() => {
    if (this.localOnly()) return this.worlds.active()?.name ?? null;
    const id = this.serverWorlds.preferred();
    return this.serverWorlds.worlds().find((w) => w.id === id)?.name ?? null;
  });

  // --- Mundos --------------------------------------------------------------
  /** Mundos deste navegador com conteúdo. O "Meu mundo" vazio não aparece ao lado dos do servidor. */
  private readonly filledLocal = signal<World[]>([]);

  /** Primeiro os mundos do servidor, os das mesas online; depois os deste navegador. */
  readonly worldLinks = computed<WorldLink[]>(() => {
    const local = this.serverWorlds.worlds().length ? this.filledLocal() : this.worlds.worlds();
    return [
      ...this.serverWorlds.worlds().map((w) => ({ id: w.id, name: w.name, local: false, firstLocal: false })),
      ...local.map((w, i) => ({ id: w.id, name: w.name, local: true, firstLocal: i === 0 && this.serverWorlds.worlds().length > 0 })),
    ];
  });
  /** Ainda cabe um mundo (no servidor, quem confere é o servidor; sem ele, este navegador). */
  readonly canCreateWorld = computed(() => (this.localOnly() ? this.worlds.canCreate() : this.serverWorlds.worlds().length < MAX_WORLDS));

  /** Nome do mundo que o Worldbuild mostra (ou mostraria ao ser aberto). */
  readonly worldbuildWorld = computed(() => {
    const url = this.url();
    const params = url.startsWith('/worldbuild') ? this.router.parseUrl(url).queryParams : {};
    if (params['local']) return this.worlds.active()?.name ?? null;
    const id = (params['servidor'] as string | undefined) ?? this.serverWorlds.preferred();
    return this.serverWorlds.worlds().find((w) => w.id === id)?.name ?? this.worlds.active()?.name ?? null;
  });

  constructor() {
    // Confere de novo ao mudar de página: um mundo local pode ter ganhado o primeiro item
    effect((onCleanup) => {
      this.url();
      this.worlds.worlds();
      let cancelled = false;
      onCleanup(() => (cancelled = true));
      untracked(() => {
        void this.worlds.withContent().then((list) => {
          if (!cancelled) this.filledLocal.set(list);
        });
      });
    });

    // Mesas online da conta do servidor: a lista segue a conta (entrou, saiu, trocou)
    effect(() => {
      const userId = this.account.user()?.id;
      untracked(() => {
        if (userId) void this.onlineTables.load().catch(() => undefined);
        else this.onlineTables.clear();
      });
    });
  }

  /** Mundo aberto agora no Worldbuild? (destaque na lista) */
  isOpenWorld(link: WorldLink): boolean {
    const url = this.url();
    if (!url.startsWith('/worldbuild')) return false;
    const params = this.router.parseUrl(url).queryParams;
    return link.local ? !params['servidor'] && link.id === this.worlds.activeId() : params['servidor'] === link.id;
  }

  /** Abre o mundo no Worldbuild. */
  openWorld(link: WorldLink): void {
    this.layout.closeMobile();
    if (link.local) {
      this.worlds.select(link.id);
      void this.router.navigate(['/worldbuild'], { queryParams: { local: 1 } });
    } else {
      void this.router.navigate(['/worldbuild'], { queryParams: { servidor: link.id } });
    }
  }

  // --- Worldbuild ----------------------------------------------------------
  /** Abre o Worldbuild na aba do tipo (no mesmo mundo, se o Worldbuild já está aberto). */
  openWorldbuildTab(type: WorldbuildType): void {
    this.goToWorldbuild({ aba: type.view });
  }

  /** Cria um item do tipo no mundo aberto (mapas: abre a aba, onde fica o botão de enviar). */
  createWorldbuildItem(type: WorldbuildType): void {
    this.goToWorldbuild(type.create ? { novo: type.create } : { aba: type.view });
  }

  private goToWorldbuild(queryParams: Record<string, string>): void {
    this.layout.closeMobile();
    const onWorldbuild = this.url().startsWith('/worldbuild');
    void this.router.navigate(['/worldbuild'], { queryParams, queryParamsHandling: onWorldbuild ? 'merge' : undefined });
  }

  // --- Conta ---------------------------------------------------------------

  async logout(): Promise<void> {
    await this.account.logout();
    await this.router.navigate(['/entrar']);
    this.snackBar.open('Você saiu da sua conta.');
  }
}

/** Grupos abertos salvos neste navegador (padrão: todos abertos). */
function readGroups(): Record<GroupId, boolean> {
  try {
    const saved = JSON.parse(localStorage.getItem(GROUPS_KEY) ?? 'null') as Partial<Record<GroupId, boolean>> | null;
    return { ...DEFAULT_GROUPS, ...(saved && typeof saved === 'object' ? saved : {}) };
  } catch {
    return { ...DEFAULT_GROUPS };
  }
}
