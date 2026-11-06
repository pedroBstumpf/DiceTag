# Arquitetura — Crônicas de Zehenia

Visão técnica do app: como as pastas se organizam, quais são as peças principais, por onde os dados
passam e onde cada parte do estado mora. As **regras de negócio** detalhadas (fichas, NPCs, névoa,
rolagens…) estão no [`CLAUDE.md`](CLAUDE.md); este documento explica o **esqueleto** que as sustenta.

---

## 1. Visão geral

Aplicação **Angular 21** de página única, **standalone** e **zoneless** (sem zone.js): toda a
reatividade vem de **signals**. As telas locais guardam os dados no **IndexedDB** do navegador (diagrama abaixo). A
**mesa online** e o mundo dela usam o servidor em `server/` (§11 e §12), pelo mesmo `TableSessionService` e pelo mesmo
`WorldbuildService`, que trocam de origem sem as telas saberem.

```
┌──────────────────────────── Navegador ────────────────────────────┐
│                                                                   │
│  Componentes (templates)  ──lêem signals──►  Serviços (estado)    │
│          │                                        │               │
│          └──── chamam métodos de mutação ────────►│               │
│                                                   │ debounce 300ms│
│                                                   ▼               │
│                                         StorageService            │
│                                    (IndexedDB "dicetag", store kv)│
└───────────────────────────────────────────────────────────────────┘
```

Três princípios guiam o código:

1. **Fonte única por domínio.** Cada conjunto de dados tem um serviço dono (mesas, worldbuild, mesa
   aberta). Componentes nunca gravam no `StorageService` diretamente para dados de domínio.
2. **Fluxo unidirecional.** Componentes leem `signal`/`computed` e chamam métodos do serviço; o serviço
   produz um novo objeto de estado (imutável), os `computed` se recalculam e a tela se atualiza.
3. **Lógica pura separada.** Geometria, visão, dados, inventário e efeitos ficam em `utils/` como
   funções puras (sem Angular), cada uma com seu `*.spec.ts`. Na mesa, as mutações do estado, as
   permissões e o que cada papel vê também são puros, em `game-table/state/` (ver §6.1).

---

## 2. Estrutura de pastas

```
src/
├── main.ts                 # bootstrap (appConfig + App)
├── index.html              # fontes (Tektur, Chakra Petch, Material Symbols Sharp)
├── styles.scss             # tema Material M3 escuro + overrides + estilos do editor
├── styles/tailwind.css     # Tailwind 4: tokens de design, animações, utilitários (.glass, sheet-*)
└── app/
    ├── app.ts / app.config.ts / app.routes.ts
    ├── core/               # domínio e dados — sem UI
    │   ├── config/         # flags globais (APP_SETTINGS.requireAuth)
    │   ├── models/         # interfaces, constantes e funções de normalização do domínio
    │   ├── services/       # serviços globais (storage, auth, mesas, layout, notícias, SheetStore)
    │   └── utils/          # newId()
    ├── shared/             # reutilizável por qualquer feature
    │   ├── components/     # FloatingWindow, EmptyState, ColorPicker, TagEditor, RichTextEditor
    │   ├── directives/     # AutoFocus
    │   ├── services/       # WindowManagerService, QuickActionsService
    │   └── utils/          # viewport.ts (pan/zoom puro)
    ├── layout/             # Shell (barra lateral + conteúdo) e Sidebar
    └── features/           # uma pasta por área do app (rotas lazy)
        ├── home/           # landing
        ├── auth/           # entrada do dono, convite e redefinir a senha
        ├── library/        # página Arquivos: biblioteca do dono
        ├── tables/         # "Minhas mesas" + diálogo de criação
        ├── worldbuild/     # Worldbuild do mundo aberto (o usuário tem até 2 mundos)
        └── game-table/     # mesa de jogo (a maior feature)
```

Regra de dependência entre camadas:

```
features ──► shared ──► core
   │                     ▲
   └─────────────────────┘
layout  ──► shared, core
```

`core` não importa nada de `shared`, `layout` ou `features`, e `layout` não importa `features`.
A regra **não é verificada automaticamente** e hoje tem três exceções conhecidas:

| De → para | O que é importado | Por quê |
|---|---|---|
| `shared` → `features` | `QuickActionsService` importa `CreateTableDialog` | as ações rápidas (barra lateral e Home) abrem esses diálogos |
| `game-table` → `worldbuild` | editores, `Explorer`, `ItemCardView`, `RaceCard`, diretiva `appWorldNpcSheet`, `WorldbuildService` | abrir a lore e os itens do mundo sem sair da mesa |
| `worldbuild` → `game-table` | `CharacterSheetView` e `BlobUrlService` | a ficha base dos NPCs do bestiário é a mesma tela da mesa |

As duas últimas formam um **ciclo** entre as features (ver o plano em [`SPEC.md`](SPEC.md)).

### Convenção de cada feature

```
features/<feature>/
├── <feature>.ts|.html      # página (componente da rota)
├── services/               # estado da feature
├── components/<nome>/      # componentes da feature (standalone, Tailwind)
├── directives/             # diretivas que trocam provedores (ver §5.3)
├── state/                  # (mesa) comandos puros do estado, permissões e visão do jogador + specs
└── utils/                  # funções puras + *.spec.ts
```

Features pequenas não seguem tudo: `auth/sign-in/`, `auth/invite/` e `tables/create-table-dialog/` ficam direto na
pasta da feature, sem `components/`.

---

## 3. Rotas e carregamento

Definidas em [`app.routes.ts`](src/app/app.routes.ts); **todas as páginas são lazy**.

| Rota | Componente | Contêiner |
|---|---|---|
| `entrar`, `convite`, `redefinir-senha` | `SignIn`, `Invite`, `ResetPassword` (abertas) | tela cheia, **fora** do `Shell` |
| `''` | `Home` (só o dono) | `Shell` |
| `mesas` | `Tables` | `Shell` |
| `arquivos` | `Library` (só o dono) | `Shell` |
| `worldbuild` | `Worldbuild` (aceita `?novo=<tipo>` e `?abrir=<id>`) | `Shell` |
| `mesa/:id` | `GameTablePage` | tela cheia, **fora** do `Shell` |
| `mesa-online/:id` | `GameTablePage` com `data: { online: true }` (mesa do servidor) | tela cheia, **fora** do `Shell` |
| `**` | redireciona para `''` | — |

Sem conta, tudo leva a `entrar` (`core/guards/account.guards.ts`). As proteções só organizam a tela: quem decide é o servidor.
`withComponentInputBinding()` entrega os parâmetros e os dados da rota como `input()` (ex.: `GameTablePage.id` e
`GameTablePage.online`).
A mesa fica fora do `Shell` para ocupar a tela inteira; o chunk dela (`game-table`) só é baixado ao
abrir uma mesa.

---

## 4. Onde fica o estado

O estado está dividido em **quatro níveis de vida**. Saber em qual nível um dado mora responde a
quase toda dúvida de "por que isso sumiu/persistiu".

| Nível | Onde | Vida útil | Exemplos |
|---|---|---|---|
| **Persistido global** | serviços `providedIn: 'root'` → IndexedDB | sempre | contas, mesas, mundos e o Worldbuild de cada mundo |
| **Persistido por mesa** | `TableSessionService.state` → `table-state:<id>` | enquanto a mesa existir | cenas, tokens, paredes, fichas, chat, pastas da lore reveladas |
| **Sessão da mesa** (não persistido) | signals do `TableSessionService` e serviços da página | até sair da mesa | ferramenta ativa, papel, tokens selecionados, tokens copiados, pincel, barras visíveis, efeitos na tela, desfazer |
| **Local do componente** | `signal` dentro do componente | enquanto o componente existir | campo em edição, aba aberta, arraste em andamento |

Fora do IndexedDB, o `localStorage` guarda a sessão (`dicetag.session`, id do usuário logado) e uma
preferência de interface (`dicetag.sidebarCollapsed`).

### 4.1 Serviços globais (`providedIn: 'root'`)

| Serviço | Estado | Chave no IndexedDB |
|---|---|---|
| `StorageService` | conexão com o banco (wrapper chave/valor `get`/`set`/`delete`) e pedido de armazenamento persistente (`requestPersistence`) | — |
| `AuthService` | `user` (conta logada ou visitante), `isLoggedIn`, `isGuest` | `users` + `localStorage dicetag.session` |
| `GameTablesService` | lista de mesas, filtrada pelo usuário atual | `tables` |
| `ServerApiService` | cliente HTTP da API do servidor (`/api`, URLs relativas, erros em `ServerError`) | — (servidor) |
| `ServerAccountService` | conta do servidor (`user`, `checked`): entrar, criar conta, sair, exportar, excluir | — (cookie HttpOnly do servidor) |
| `OnlineTablesService` | mesas online da conta do servidor (`tables`) e convites | — (servidor) |
| `WorldsService` | mundos do usuário (até 2) e o mundo aberto (`activeId`); criar, renomear, excluir | `worlds:<userId>` + `localStorage dicetag.world.<userId>` |
| `WorldbuildService` | árvore de `WorldItem` do **mundo aberto** (`items`, `byId`, `worldItems`, `worldNpcs`, `worldRaces`) | `worldbuild:<userId>` (1º mundo) ou `worldbuild:<userId>:<worldId>` |
| `LayoutService` | barra lateral recolhida / modo mobile | `localStorage dicetag.sidebarCollapsed` |
| `NewsService` | notícias do mural (vazio por enquanto) | — |
| `QuickActionsService` | atalhos globais (login, criar mesa, abrir worldbuild) — sem estado próprio | — |

Arquivos binários (mapas, imagens, áudios, imagens de token) são gravados à parte pela `FileStore`
(`core/services/file-store.ts`): `LocalFileStore` = IndexedDB, chaves `blob:<id>`; `ServerFileStore` = `/api/files`
(mesa online). Os objetos de domínio guardam só o `blobId`; a mesa grava por `SheetStore.files`.

### 4.2 Serviços por página (fornecidos no componente)

Estes serviços existem **uma vez por página aberta** e morrem com ela:

| Página | Provedores |
|---|---|
| `GameTablePage` | `TableSessionService`, `SheetStore → TableSessionService`, `SoundMixerService`, `BlobUrlService`, `WindowManagerService` |
| `Worldbuild` | `WindowManagerService`, `BlobUrlService` |

- **`TableSessionService`** — o coração da mesa (ver §6). Estende `SheetStore`.
- **`SoundMixerService`** — um `HTMLAudioElement` por som; estado "tocando" só na sessão.
- **`BlobUrlService`** — cache de *object URLs* dos Blobs (imagens de token, mapas), liberados ao sair.
  Mora em `game-table/services/`, mas também é fornecido pelo `Worldbuild` (é genérico; candidato a `shared/`).
- **`WindowManagerService`** — lista de janelas abertas (`id`, geometria, z-index, minimizada, fixada).

---

## 5. Padrões de fluxo de dados

### 5.1 Leitura → mutação → persistência

Os serviços com edição frequente (`TableSessionService` e `WorldbuildService`) seguem este
ciclo. `GameTablesService` e `AuthService` mudam pouco e gravam na hora (`await storage.set`), sem debounce.

```
componente                    serviço                           IndexedDB
    │  lê session.scenes()       │                                  │
    │◄───────────────────────────│ computed(() => state().scenes)   │
    │                            │                                  │
    │  session.moveToken(id, p)  │                                  │
    │───────────────────────────►│ dispatch('moveToken', payload)   │
    │                            │   ├─ applyCommand (state/, puro) │
    │                            │   ├─ state.set(novo estado)      │
    │◄── computed recalculam ────│   └─ agenda flush() em 300ms     │
    │                            │                                  │
    │                            │ flush() ────── storage.set ─────►│
```

Na mesa, a mutação é um **comando** (ver §6.1). No `WorldbuildService`, ela ainda é feita direto
no signal (`_items.update`), seguida do mesmo `persist()` com debounce.

- **Debounce de 300ms**: várias alterações seguidas viram uma gravação só.
- **`flush()` imediato** em `pagehide` e ao destruir a página, para não perder a última alteração.
- **Imutabilidade**: mutações sempre criam objetos novos (spread). Mutação de token por id troca só a
  cena que o contém — as outras mantêm a mesma referência e os `computed` delas não recalculam.

### 5.2 Carregamento e compatibilidade com dados antigos

Ao carregar, o dado salvo passa por uma função de normalização que preenche campos novos com o padrão:

- `normalizeState` (mesa) — cenas sem `walls`/`drawings`/`notes`, sons sem volume, fichas sem barras de status;
- `normalizeSheet` / `sheetOf` (ficha) — temas, páginas fixas das anotações, defeitos, estudos;
- `migrateTimeline` (worldbuild) — linhas do tempo antigas viram mapa mental.

Por isso **todo campo novo nos modelos é opcional** e tem valor padrão na leitura.

**Troca de usuário ou de mundo:** `WorldsService`, `WorldbuildService` e `GameTablesService` observam
`auth.user()` com um `effect`; o `WorldbuildService` também observa o mundo aberto (`WorldsService.activeId`).

- `WorldbuildService` grava as pendências do mundo/usuário anterior antes de trocar a chave e descarta
  carregamentos que terminem depois da troca.
- `GameTablesService` só recarrega a lista (todas as mesas ficam numa chave e são filtradas por
  `ownerId`); não tem pendências nem proteção contra um carregamento antigo terminar depois.

### 5.3 Injeção de dependência como "escopo de dados"

A mesma tela de ficha funciona com fontes de dados diferentes trocando o provedor no elemento:

```
                     ┌── na mesa ──────────► TableSessionService  (fichas da mesa)
CharacterSheetView ──┤
 inject(SheetStore)  └── appWorldNpcSheet ─► WorldNpcStore       (ficha base do bestiário)
```

- **`SheetStore`** (`core/services/sheet-store.ts`) é uma classe abstrata: declara como ler/gravar uma
  ficha (`sheetData`, `updateSheet`, `updateStatus`…) e implementa as operações de inventário comuns.
  `TableSessionService` e `WorldNpcStore` são as duas implementações.
- **`appWorldNpcSheet`** fornece `{ provide: SheetStore, useExisting: WorldNpcStore }`.

Os editores do Worldbuild (`Explorer`, `DocumentEditor`, `RaceCard`…) usam sempre o `WorldbuildService`,
que carrega o **mundo aberto**; na mesa, o mundo aberto é o da mesa. Nenhum editor precisa saber de qual mundo vêm os dados.

### 5.4 Effects: armadilhas evitadas

- Effects que só devem reagir a um signal usam `untracked()` no corpo (ex.: a mesa carrega só quando o `id` muda).
- Effects que carregam Blobs dependem de um `computed` estreito (só o `blobId`), para não recarregar a cada edição.
- Effects assíncronos registram `onCleanup` antes do `await` e conferem cancelamento depois.
- Cálculos caros (visão, névoa) usam `computed` com igualdade por valor e redesenho em `requestAnimationFrame`.

---

## 6. Mesa de jogo (`features/game-table`)

### 6.1 `TableSessionService`

Um por mesa aberta. Guarda o `TableState` inteiro num único `signal` privado e expõe tudo por
`computed` e métodos de mutação. Está organizado em seções (`// --- Seção ---`):

| Seção | Conteúdo |
|---|---|
| Estado persistido | `state`, `scenes`, `entries`, `activeScene`, `entryById`, `soundMaster`, `lore` |
| Vista isométrica e camadas | `isometric`, `mapLevels`, `playerLevel`, `currentLevel` |
| Névoa e paredes | `walls` da camada em foco, origens de visão, polígonos de visão, `fogView` |
| Memória da névoa | máscara de áreas exploradas (bitset em base64) |
| Estado da sessão | `tool`, `role`, seleção de tokens (`selectedTokenId` principal + `selectedTokenIds`, alterada só por `selectToken`/`toggleTokenSelection`/`selectTokens`), `wallMode`, `brush`, `panels`, `immersive` |
| Ações e quem age | `actor`, `actorSheetId`, `hotbar`, `useAction`, `quickRoll` |
| Permissões | `canEdit`, `sheetAccess`, `canOpenSheet`… (delegam a `state/permissions.ts`) |
| Chat / Efeitos | mensagens (máx. 300) / efeitos transitórios na tela |
| Cenas, pastas, camadas, arquivos, NPCs, fichas, lojas, lore, itens, tokens, paredes, desenhos, anotações | métodos públicos que montam o payload e chamam `dispatch` |
| Comandos e persistência | `dispatch` (único ponto de alteração; debounce) e `flush` |

O serviço é uma **fachada**: os componentes só conhecem os métodos dele. O que **não é puro** fica nele
(ids e horários novos, Blobs, o Worldbuild dos NPCs do bestiário, os signals da sessão); o que é puro
fica em `state/`:

| Arquivo em `state/` | Conteúdo |
|---|---|
| `commands.ts` | catálogo `TABLE_COMMANDS`, tipo `TableCommand` e `applyCommand` |
| `scenes.ts`, `levels.ts` | cenas, pastas de cenas e camadas do mapa |
| `entries.ts` | arquivos da mesa e volume mestre |
| `tokens.ts` | colocar/mover/alterar/remover tokens e a **regra de vínculo** (`resolveToken`, `splitTokenPatch`) |
| `inventory.ts` | itens que mudam de lugar (`transferItem`, `dropFromInventory`, `pickUpDrop`): um comando só, para nunca valerem pela metade com várias pessoas na mesa |
| `fog.ts`, `drawings.ts`, `notes.ts`, `chat.ts`, `lore.ts` | névoa e paredes, desenhos, anotações, chat, pastas da Lore reveladas e itens da mesa |
| `npc-abilities.ts` | habilidades dos NPCs do bestiário: moram no NPC do mundo (`WorldItem.abilities`) e viram ações do NPC-referência na mesa (não é comando: o `TableSessionService` grava no `WorldbuildService`) |
| `permissions.ts` | regras de acesso puras (`canEdit`, `sheetAccess`, `canSeeLoreItem`…), com quem olha (`Viewer`) como parâmetro |
| `player-view.ts` | o que o jogador vê sob a névoa (`visibleTokensFor`, `visibleNotesFor`, `visibleDoorsFor`) |
| `table-state.ts`, `helpers.ts` | estado vazio, `normalizeState` e auxiliares (`mapScene`, `mapPlacement`, `findPlacement`…) |

Cada comando é `(estado, payload) → novo estado`, com payload serializável: ids, horários e sorteios
já vêm prontos do serviço. Comando que não muda nada devolve o mesmo objeto, e o `dispatch` não grava.

Regras com dono único: vínculo dos tokens (`state/tokens.ts`), quem age (`actor`), permissões
(`state/permissions.ts`) e transferência de itens (`state/inventory.ts`; o serviço só duplica a imagem antes).

### 6.2 Composição da página

```
GameTablePage  (providers da mesa; atalhos de teclado na window; abre janelas)
├── MapStage            ← orquestrador do mapa (vista, zoom/pan, tela↔mundo, ferramentas, WASD)
│   └── camadas do "mundo", de baixo para cima:
│       mapa · grade · DrawingsLayer · NotesLayer · FogLayer (canvas) · TokensLayer
│       · DoorsLayer · WallsLayer · FxLayer · régua/ping   (+ NotePopover fora do mundo)
├── SceneBar            ← topo: cenas e pastas, vista isométrica
├── ToolBar             ← esquerda: ferramentas + DrawMenu / FogMenu / FxMenu / LevelsMenu
├── SidePanel           ← direita: abas Chat · Fichas · Lore · Sons · Ações
│   ├── ChatPanel
│   ├── Explorer        ← aba Lore: a árvore do mundo da mesa (do worldbuild)
│   └── SoundList
├── ActionBar           ← baixo: 10 espaços de ações + QuickRoll (overlay do CDK)
└── camada de janelas   ← FloatingWindow por janela aberta; o conteúdo é escolhido por tipo:
    CharacterSheetView (SheetInventory, SheetNotes, LevelPips) · TokenWindow (TokenEditor)
    · EntryWindow (FxPicker) · EquippedItemWindow · TableItemWindow
    · DocumentEditor · TimelineEditor · ImageViewer · ItemCard   (do worldbuild)
```

- **`MapStage`** decide o que cada evento de ponteiro faz conforme a ferramenta e chama o
  `TableSessionService`. As **camadas** (`map-layers/`) só desenham e emitem eventos (`tokenDown`, `noteDown`).
- **Vista**: `Viewport` (`shared/utils/viewport.ts`) + matriz 2D/isométrica (`utils/projection.ts`).
  Toda conversão tela↔mundo passa por `project`/`unproject`.
- Desenho sem bibliotecas: **SVG** para desenhos, paredes, régua e efeitos; **`<canvas>`** para a névoa;
  **HTML** posicionado (`div`/`img`) para tokens, marcadores de anotação e botões de porta (o X de token
  derrotado é um SVG dentro do token).

### 6.3 Janelas

`GameTablePage.content(id)` traduz o **id da janela** no que ela exibe e aplica as permissões
(retorna `null` = não abre):

| Id | Conteúdo |
|---|---|
| `<id da entrada>` | ficha (personagem/NPC) ou `EntryWindow` (automação) |
| `npc:<id do token>` | ficha própria do token de NPC |
| `token:<id do token>` | janela "Token" (fecha sozinha se o token sair do mapa) |
| `equip:<ficha>:<item>` | cartão de item equipado |
| `<id de item da mesa>` | `TableItemWindow` |
| `<id de item da lore>` | editor do Worldbuild (item do mundo da mesa; jogador: só em pasta revelada) |

O `WindowManagerService` só guarda geometria e ordem; abrir de novo o mesmo id foca a janela.

### 6.4 Fluxo de exemplo: usar uma ação

```
tecla "1" ──► GameTablePage.onKeydown ──► useSlot(0) ──► onActionUsed(entry)
                                                           │
     TableSessionService.useAction(entry, sheetId) ◄───────┘
       ├─ tagLevelsOf / rollTagsOf  → níveis atuais das tags (temas + itens equipados)
       ├─ utils/dice.ts: roll + effectiveModifier → RollResult
       ├─ trainStudies → Estudos e Treinos (pode avisar "subiu de nível")
       ├─ pushChat(...)            → state.chat (persistido)
       └─ armedFx.set(...)         → efeito no mouse (sessão)
GameTablePage mostra o snackbar; o próximo arraste no mapa lança o efeito (castFx → FxLayer).
```

### 6.5 Fluxo de exemplo: visão e névoa

```
tokens + paredes da camada em foco
   └─► visionSources (computed, igualdade por valor)
         └─► computeVisibilityPolygon (utils/visibility.ts) por token
               ├─► FogLayer redesenha o <canvas> (agrupado em requestAnimationFrame)
               └─► markPolygons (utils/fog-memory.ts) → Scene.explored (persistido)
```

Mudar o volume de um som ou o nome de uma ficha não muda as origens de visão, então nada disso recalcula.

---

## 7. Mundos e Worldbuild (`core/services/worlds.service.ts`, `features/worldbuild`)

- **Mundos**: cada usuário tem até 2 (`WorldsService`, em `core/` porque Worldbuild, mesas e barra lateral o usam).
  Cada mundo é um Worldbuild separado; cada mesa se passa num mundo (`GameTable.worldId`).
- **Página** `Worldbuild`: explorador (com seletor de mundo no cabeçalho) à esquerda + área de janelas flutuantes.
- **Dados**: lista plana de `WorldItem` com `parentId` (árvore). Tipos: `folder`, `document`, `timeline`,
  `image`, `item`, `npc`, `race`. Uma lista por mundo (`worldbuild:<userId>` no primeiro, `worldbuild:<userId>:<worldId>` nos demais).
- **Mesa de trabalho persistida**: as janelas da página Worldbuild são salvas por mundo (`WorldbuildService.desk`,
  `desk:<userId>:<worldId>`) e restauradas pelo `WindowManagerService.restore`. Pastas abrem como janela (`FolderView`).
- **Componentes**: `Explorer` (abas em ícones: Arquivos/Itens/NPCs/Raças/Linhas do tempo/Documentos/Mapas), `RaceCard`, `DocumentEditor` (sobre o `RichTextEditor`/Tiptap),
  `TimelineEditor` (mapa mental; layout puro em `utils/timeline-layout.ts`), `ImageViewer`,
  `ItemCard`/`ItemCardView`, e a ficha de NPC reaproveitada da mesa com `appWorldNpcSheet`.
- **Na mesa**, a aba Lore é o próprio `Explorer` do mundo da mesa (mesmo `WorldbuildService`): o que o mestre
  muda ali muda o mundo, e vice-versa. A mesa guarda só as pastas reveladas aos jogadores
  (`TableState.lore.revealed`); para o jogador, o `Explorer` fica em só leitura e filtrado (`readonly`, `visible`).

---

## 8. Modelos (`core/models`)

| Arquivo | Conteúdo |
|---|---|
| `geometry.model.ts` | `Point`, `Rect` |
| `user.model.ts` | `User`, `StoredUser` |
| `game-table.model.ts` | `GameTable`, `GAME_SYSTEMS`, `TABLE_ACCENTS` |
| `table-session.model.ts` | `TableState` e tudo que está dentro dele (cenas, tokens, paredes, desenhos, notas, entradas, ficha, inventário, rolagens, chat) + constantes e funções puras de normalização (`withStatusBars`, `defaultToken`, `defaultSheet`…) com spec |
| `tag.model.ts` | `Tag` (texto, cor, nível) e `TAG_COLORS` |
| `world-item.model.ts` | `WorldItem`, `TimelineEvent`, `TimelineLink`, `WORLD_ITEM_META`, padrões de NPC (`npcSheetOf`, `npcTokenOf`) |
| `news.model.ts` | `NewsPost` |

---

## 9. Lógica pura e testes

Funções sem Angular, testadas com **Vitest** (`npx ng test --watch=false`):

| Arquivo | Responsabilidade |
|---|---|
| `shared/utils/viewport.ts` | zoom no cursor, enquadramento, tela↔mundo |
| `worldbuild/utils/timeline-layout.ts` | layouts, setas e hit test do mapa mental |
| `game-table/utils/geometry.ts` | snap de token/canto, alça de tamanho, distâncias |
| `game-table/utils/projection.ts` | matriz isométrica, `project`/`unproject`, "em pé" |
| `game-table/utils/visibility.ts` | ray casting da visão, paredes/portas → segmentos |
| `game-table/utils/walls.ts` | mover parede/alça, distância até a parede |
| `game-table/utils/fog-memory.ts` | máscara de áreas exploradas (bitset base64) |
| `game-table/utils/simplify.ts` | Ramer–Douglas–Peucker dos traços |
| `game-table/utils/dice.ts` | rolagens 2d12/3d6, faixas, modificadores, estudos |
| `game-table/utils/inventory.ts` | quantidade, transferência, linha do inventário |
| `game-table/utils/race.ts` | raça e sub-raça na ficha: rótulos e modificadores de status, aplicar e desfazer |
| `game-table/utils/selection.ts` | seleção de vários tokens: principal, Shift+clique, caixa de seleção, formação do grupo |
| `game-table/utils/effects.ts` | os 20 efeitos especiais descritos como dados SVG |

Também têm specs:
- os comandos, as permissões e a visão do jogador em `game-table/state/` (`commands`, `scenes`, `tokens`,
  `map`, `lore`, `npc-abilities`, `permissions`, `player-view`);
- `table-session.model.ts` e a `FxLayer`;
- o `TableSessionService`, num teste de integração da fachada com o armazenamento em memória
  (`table-session.service.spec.ts`).

---

## 10. Interface e estilo

- **Tailwind 4** nas classes dos templates; tokens de design (`ink-*`, `astral-*`, `star-*`) em
  `src/styles/tailwind.css`. Sem `.scss` por componente.
- **Angular Material** (M3, escuro) para botões, menus, diálogos, tooltips e snackbars; overrides em `styles.scss`.
- **CDK** para reordenar as páginas das anotações (`cdkDropList`) e para o overlay do `QuickRoll`.
- **Arrastar nativo do HTML5** (`draggable` + `dragstart`/`drop`) para levar fichas do painel ao mapa,
  e itens entre pastas no `Explorer` (também na aba Lore da mesa).
- **`FloatingWindow`** é a peça central da UX: arrastar, redimensionar, minimizar, maximizar e fixar,
  com estado em `model()` controlado pelo `WindowManagerService` da página.

---

## 11. Servidor (`server/`)

Pacote Node separado (Fastify + `ws` + `node:sqlite` + zod), com guia em [`server/README.md`](server/README.md),
regras de segurança em [`BACKEND_SECURITY.md`](BACKEND_SECURITY.md) e operação em [`server/OPERATIONS.md`](server/OPERATIONS.md).

- **Camadas:** `http/routes` e `realtime/` → `services/` → `repositories/` (único lugar com SQL) → SQLite.
  `context.ts` monta as dependências (injeção manual); `app.ts` monta HTTP + WebSocket sem escutar (os
  testes usam o mesmo app com banco em memória). Toda rota exige sessão, menos as marcadas como públicas
  (`PUBLIC`), e os repositórios conferem dono e participação dentro das consultas.
- **Regras compartilhadas:** `server/src/domain/index.ts` importa direto de `src/app` os comandos
  (`applyCommand`), as permissões, a rolagem e as paredes. Esses arquivos precisam continuar **sem Angular**:
  o servidor os executa. Novo comando no front exige esquema em `realtime/command-schemas.ts` e regra em
  `realtime/command-rules.ts` (o tipo obriga; sem isso o servidor não compila). O mesmo vale para um campo
  novo na ficha (`SHEET_SCHEMA_IS_COMPLETE`); as regras da ficha para jogadores ficam em
  `realtime/sheet-rules.ts` (raça aplicada pelo servidor, máximo das barras, itens revelados).
- **Sala da mesa:** `Room` guarda o estado oficial e a versão. Cada comando passa por formato →
  autorização → `applyCommand` → gravação agrupada (500 ms). Quem enviou recebe `ack`, o mestre recebe o
  comando e os jogadores recebem o estado **projetado** (`realtime/projection.ts`), só quando ele muda.
- **Visão no servidor:** `realtime/vision.ts` calcula a névoa da cena aberta com as funções de
  `state/player-view.ts` (`visionSourcesOf`, `visionPolygonsOf`), uma vez por versão para todos os
  jogadores. Com névoa, o jogador recebe os polígonos (`vision`) e só o que está à vista, sem as paredes.
- **Mundo da mesa na sala:** `realtime/world.ts` (`WorldView`) lê do banco, com cache, o token padrão
  dos NPCs do bestiário e as Raças/itens usados pelas regras; as rotas do Worldbuild avisam o hub.
- **Papel vem da conta:** dono da mesa = mestre; quem entra por convite = jogador (`table_members`).
- **Ligação com o front:** em desenvolvimento, `proxy.conf.json` repassa `/api` e `/ws` do `ng serve` para
  `localhost:3000`, então o front usa URLs relativas e o cookie de sessão na mesma origem. A parte ligada é a
  **mesa online** e o mundo dela (§12).
- **Recuperação de senha:** `AuthService.createPasswordReset`/`resetPassword`, tabela `password_resets` (só o HMAC do
  token) e `services/mailer.ts` (`MAIL_PROVIDER`). O e-mail sai sem o cliente esperar: o tempo de resposta não entrega se a
  conta existe.
- **App entregue pelo servidor** (`http/routes/frontend.ts`, ligado por `FRONTEND_DIR`): o build do Angular na
  mesma origem da API, num processo só. A lista de arquivos é montada ao subir (nada da URL vira caminho no
  disco); rotas sem extensão caem no `index.html`; `/api`, `/ws` e `/dev` nunca caem no app. CSP própria
  (`frontendCsp`): scripts só do servidor, estilos inline permitidos (Angular/Material/Tiptap), Google Fonts.

- **Só por convite:** dono (terminal, entra pelo e-mail) e convidados (`/invites/redeem` com nome + senha; entram pelo nome), ver `CLAUDE.md` §7. Sem rota de cadastro.
- **Rodando de verdade (`npm run mesa`):** dois processos. O principal cuida do túnel; o servidor, compilado e com `--permission` do
  Node, só alcança a pasta do app e não executa programas. Conversam por IPC, com operações fixas (`services/host-control.ts`):
  ```
  navegador ── Tailscale Funnel ── 127.0.0.1:3000 ── servidor isolado ── IPC ── scripts/mesa.ts ── tailscale
                                                          └── Documentos\Cronicas de Zehenia (dados, arquivos, biblioteca)
  ```
- **Biblioteca** (`services/library.service.ts`, `security/library-path.ts`): pasta real do dono; os jogadores só recebem cópias enviadas à mesa.

## 12. Rumo ao backend

O servidor já existe (§11) e a **mesa online** o usa por inteiro, com o mundo dela; contas, mesas e mundos locais continuam
no navegador. O plano completo está no [`SPEC.md`](SPEC.md).

### 12.1 Mesa online (já ligada)

```
Minhas mesas → OnlineTables ── OnlineTablesService / ServerAccountService ── ServerApiService ── /api
/mesa-online/:id → GameTablePage ─┬─ session.connect(id) ── TableRoom ── /ws/tables/:id
                                  │        │
                                  │   dispatch → state/sync.ts (confirmado + pendentes = tela) → envio (rajadas a cada 100 ms)
                                  │   welcome/state/cmd/ack/nack → state/sync.ts → state.set(view)
                                  │   event (ping, efeito) → repassado, sem gravar · world → busca a Lore de novo
                                  └─ worldbuild.openOnline(...) ── /worlds/:id/items (dono) · /tables/:id/lore (jogador)
```

- O `TableSessionService` é o mesmo nas duas mesas: sem sala, grava no IndexedDB; com sala, nunca grava no
  navegador. O papel vem do `welcome`; as rolagens são pedidas ao servidor; o jogador com névoa usa a visão do servidor.
- Arquivos da mesa online e do mundo vão para o servidor (`ServerFileStore`, único caminho de envio: é ela que tira os
  metadados das imagens); a leitura tenta o navegador antes (mesas antigas).
- **Mundo:** o `WorldbuildService` tem duas origens com a mesma interface. No servidor, o dono grava item a item (agrupado
  em 1 s); o jogador recebe só o que `projectLore` libera. Quem controla um NPC do bestiário grava por uma rota própria.
- **Sons:** `TableState.playing` é a fonte: o mixer de todas as máquinas segue essa lista e entra no ponto certo da faixa.
- **Testes:** `npm run e2e` em `server/` abre o app em dois navegadores reais na mesma mesa.

### 12.2 Para o resto do app

- **O que já ajuda:**
  - toda mutação da mesa é um comando puro e serializável, aplicado por um único `dispatch`: é o que
    será enviado ao servidor, e o servidor aplicará a mesma função;
  - permissões e visão do jogador são funções puras que o servidor pode reaproveitar;
  - a rolagem recebe o sorteio como parâmetro.
- **O que ainda não é a interface de uma API:**
  - o `StorageService` é chave/valor (`get`/`set` de `worldbuild:<userId>`…), e não operações de domínio;
  - o `AuthService` guarda contas no IndexedDB, sem tokens nem expiração.

  Ambos serão trocados por **repositórios por domínio** fornecidos por injeção de dependência (SPEC §2).
- **O que só o servidor pode garantir:** a projeção do estado por jogador (névoa, segredos do mestre),
  as rolagens e a validação de cada comando (SPEC §3). Na mesa local o papel é escolhido na mesa; na online,
  já vem da conta e do convite.
