# CLAUDE.md — Crônicas de Zehenia

Contexto do projeto para o Claude Code. Leia antes de qualquer alteração.
Idioma de trabalho: **português do Brasil** (respostas, comentários no código e textos da interface).
Visão da arquitetura (camadas, fluxos de dados, onde fica o estado): [`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## 1. Resumo executivo

**Crônicas de Zehenia** (antigo DiceTag) é um VTT (Virtual Tabletop): um aplicativo web para jogar RPG de mesa
online com amigos, no mundo de Zehenia.
A meta final inclui simular eventos, calcular rolagens, manter fichas, criar mapas, tocar sons e
organizar toda a atmosfera de uma campanha.

**Estado atual (MVP de interface, sem backend):**

| Área | Status |
|---|---|
| Landing page (banner com logo, atalhos, mural de notícias vazio) | Pronto |
| Barra lateral global (navegação, **mundos** do usuário, atalhos para as **mesas** — até 6 + "Ver todas" —, conta) | Pronto |
| **Mundos**: até 2 Worldbuilds separados por usuário; cada mesa se passa num mundo | Pronto |
| Contas (login/cadastro locais) + **modo de teste sem conta** | Pronto (provisório) |
| Minhas mesas (criar, listar, excluir com limpeza dos dados, abrir) | Pronto |
| Worldbuild (pastas, documentos rich text, **linha do tempo em mapa mental**, mapas/imagens, **itens com cartão**) | Pronto |
| **Mesa de jogo** (mapa em camadas, 4 barras escondíveis, janelas flutuantes) | Pronto |
| **Vista isométrica** por cena + **camadas do mapa** (até 5, "ar" para voo) + **pastas de cenas** | Pronto |
| Sons: **mixer** com faixas simultâneas, volume/repetição por faixa e volume mestre | Pronto |
| **Tokens** (imagem, tamanho, visão, barras e etiquetas com cor/nível; vínculo personagem/NPC; WASD com velocidade configurável) | Pronto |
| **Névoa de guerra + paredes + portas** (visão por ray casting, por papel, memória de áreas exploradas) | Pronto |
| **Pincel** (desenho livre, borracha, Ctrl+Z) e **anotações** no mapa | Pronto |
| **Ficha de personagem** (abas Ficha, Inventário, Anotações, Habilidades; cards Básico, Status, Relações, 3 Temas) | Pronto |
| **Ficha de NPC** (igual à de personagem, sem Anotações nem Relações; controle por jogador; ficha/inventário públicos; **loja em Eiros**) | Pronto |
| **Automações** (dono personagem/NPC/geral, ícone, rolagem 2d12/3d6 + modificador, efeito especial) | Pronto |
| **Rolagem de dados** (2d12: falha crítica…sucesso crítico; 3d6: azar/neutro/sorte) + **chat** da mesa | Pronto |
| **Efeitos especiais** no mapa (20 efeitos em 4 grupos; 13 cores por elemento) | Pronto |
| Backend, multiplayer em tempo real | Não iniciado |

Todos os dados ficam **no navegador (IndexedDB)**. Não há API.

---

## 2. Diretrizes do dono do projeto (obrigatórias)

1. **Stack:** Angular + Tailwind + Angular Material. App leve, responsivo e fluido.
2. **Código limpo e comentado:** comentários em PT-BR explicando a responsabilidade de cada trecho
   (cabeçalho JSDoc em cada classe + separadores `// --- Seção ---`). Estrutura de pastas profissional padrão Angular.
3. **Simplicidade:** sempre a solução mais rápida, prática e profissional. Não criar problemas ao resolver outros.
   Não adicionar bibliotecas sem necessidade real.
4. **Design moderno e simples:** janelas arrastáveis e redimensionáveis, barras escondíveis, componentes intuitivos.
5. **UX de VTT:** experiência fluida e imersiva. A interface **não pode atrapalhar a visão** do que importa (o mapa, a história).

---

## 3. Stack e comandos

- **Angular 21** (standalone, **zoneless** — não há zone.js), TypeScript 5.9
- **Angular Material 21** (tema M3, escuro) + **CDK** (drag-drop, layout)
- **Tailwind CSS 4** via PostCSS (`.postcssrc.json`), tema em `src/styles/tailwind.css` (sem `tailwind.config.js`)
- **Tiptap 3** (editor rich text dos documentos e das anotações da ficha — `RichTextEditor`)
- **Vitest** (via `@angular/build:unit-test`) para funções puras em `utils/`
- Desenho do mapa sem bibliotecas: **SVG** (desenhos, paredes, setas) e **`<canvas>`** (névoa)
- Node 20.19+ ou 22.12+

```bash
npm install                  # .npmrc usa legacy-peer-deps=true (contorna erro de peer deps do npm com vitest)
npm start                    # http://localhost:4200
npm run build                # SEMPRE rodar após alterações para validar (deve terminar sem erros)
npx ng test --watch=false    # testes Vitest (*.spec.ts), uma execução
```

Configuração relevante do `angular.json` (produção):
- `optimization.fonts: false` → não tenta embutir Google Fonts no build (evita travar em redes restritas).
- Budgets: inicial 800kB aviso / 1.5MB erro; estilo por componente 6kB / 12kB.
  O aviso subiu para **850kB** porque o CSS global do Tailwind cresce com cada tela nova (inicial hoje ~801kB,
  dos quais ~88kB de CSS). Evite importar coisas pesadas fora das rotas lazy.

---

## 4. Estrutura de pastas

```
src/
├── index.html                  # fontes: Chakra Petch, Tektur, Material Symbols Sharp
├── styles.scss                 # tema Material (M3) + overrides + base + estilos do editor (.prose-editor)
├── styles/tailwind.css         # Tailwind 4: tokens (@theme static), animações, utilitário .glass
└── app/
    ├── app.ts / app.config.ts / app.routes.ts
    ├── core/                   # regras e dados — sem UI
    │   ├── config/app-settings.ts      # flags globais (requireAuth)
    │   ├── models/                     # interfaces e constantes de domínio
    │   │   ├── geometry.model.ts       # Point, Rect
    │   │   ├── user.model.ts
    │   │   ├── game-table.model.ts     # GameTable, GAME_SYSTEMS, TABLE_ACCENTS
    │   │   ├── table-session.model.ts  # Scene, TableEntry, TableState, tokens, paredes, traços, anotações,
    │   │   │                           # ficha (CharacterSheet, STATUS_BARS, withStatusBars), constantes + spec
    │   │   ├── tag.model.ts            # Tag (etiqueta: texto, cor, nível) e TAG_COLORS
    │   │   ├── world-item.model.ts     # WorldItem (inclui `item`), TimelineEvent, TimelineLink, WORLD_ITEM_META, TIMELINE_COLORS
    │   │   ├── world.model.ts          # World (mundo), MAX_WORLDS = 2, DEFAULT_WORLD_ID, worldbuildKey
    │   │   └── news.model.ts
    │   ├── services/
    │   │   ├── storage.service.ts      # wrapper chave/valor do IndexedDB (get/set/delete)
    │   │   ├── auth.service.ts         # contas locais + visitante
    │   │   ├── sheet-store.ts          # SheetStore: contrato da fonte de dados da ficha + inventário em comum
    │   │   ├── game-tables.service.ts  # CRUD de mesas (excluir apaga table-state e blobs)
    │   │   ├── worlds.service.ts       # mundos do usuário (lista, aberto, criar/renomear/excluir) + spec
    │   │   ├── layout.service.ts       # barra lateral (recolhida/mobile)
    │   │   └── news.service.ts         # notícias (vazio por enquanto)
    │   └── utils/id.ts                 # newId() com fallback fora de HTTPS
    ├── shared/                 # reutilizável entre features
    │   ├── components/floating-window/ # JANELA FLUTUANTE (peça central da UX)
    │   ├── components/empty-state/
    │   ├── components/color-picker/    # bolinha de cor + paleta (mat-menu) + cor livre
    │   ├── components/tag-editor/      # lista editável de etiquetas (cor, texto, nível): token, ficha, item
    │   ├── components/rich-text-editor/ # Tiptap + barra de formatação (documentos e anotações da ficha)
    │   ├── directives/auto-focus.directive.ts
    │   ├── services/
    │   │   ├── window-manager.service.ts  # abre/fecha/foca janelas (fornecido por página)
    │   │   └── quick-actions.service.ts   # ações globais: login, criar mesa, abrir worldbuild
    │   └── utils/viewport.ts           # pan/zoom puro (zoomAt, fitRect, screenToWorld) + spec
    ├── layout/
    │   ├── shell/              # barra lateral + área de conteúdo (todas as páginas exceto a mesa)
    │   └── sidebar/
    └── features/
        ├── home/               # landing
        ├── auth/auth-dialog/   # diálogo único Entrar/Criar conta
        ├── tables/             # "Minhas mesas" + create-table-dialog
        ├── worldbuild/
        │   ├── worldbuild.ts           # página: explorador (com seletor de mundo) + área de janelas
        │   ├── services/worldbuild.service.ts   # itens e mesa de trabalho do mundo aberto; migração de timelines antigas
        │   ├── services/world-npc.store.ts      # SheetStore das fichas base do bestiário (NPCs do Worldbuild)
        │   ├── directives/world-npc-sheet.directive.ts  # appWorldNpcSheet: a ficha usa o WorldNpcStore
        │   ├── utils/timeline-layout.ts         # layouts, setas e hit test do mapa mental + spec
        │   ├── utils/references.ts              # referências dos eventos da linha do tempo a itens do mundo + spec
        │   └── components/ explorer (abas Arquivos/Itens/NPCs/Raças/Linhas do tempo/Documentos/Mapas), race-card,
        │                   document-editor, timeline-editor, image-viewer,
        │                   item-card (ItemCard + ItemCardView)
        └── game-table/         # MESA DE JOGO (rota /mesa/:id, tela cheia, fora do Shell)
            ├── game-table.ts           # página: orquestra barras, janelas e atalhos
            ├── services/
            │   ├── table-session.service.ts  # FACHADA da mesa: signals, Blobs, sessão; toda mutação via dispatch + spec
            │   ├── sound-mixer.service.ts    # um HTMLAudioElement por som
            │   └── blob-url.service.ts       # object URLs com cache (imagens de token)
            ├── state/                  # puro + specs: comandos (estado, payload) → estado, permissões, visão
            │   ├── commands.ts         # TABLE_COMMANDS, TableCommand, applyCommand (catálogo de comandos)
            │   ├── scenes.ts levels.ts entries.ts tokens.ts fog.ts drawings.ts notes.ts chat.ts lore.ts
            │   ├── permissions.ts      # canEdit, sheetAccess, canSeeLoreItem… com Viewer { role, userId }
            │   ├── player-view.ts      # o que o jogador vê sob a névoa (tokens, anotações, portas)
            │   └── table-state.ts helpers.ts  # EMPTY_STATE, normalizeState, mapScene/mapPlacement…
            ├── utils/                  # funções puras + specs Vitest
            │   ├── geometry.ts         # snap de token/canto, alça de tamanho, distâncias
            │   ├── visibility.ts       # visão por ray casting, paredes/portas → segmentos, ponto-em-polígono, doorSeen
            │   ├── walls.ts            # mover parede/alça, distância até a parede
            │   ├── fog-memory.ts       # máscara de áreas exploradas (bitset base64)
            │   ├── simplify.ts         # Ramer–Douglas–Peucker (traços)
            │   ├── projection.ts       # matriz 2D/isométrica, tela↔mundo, enquadramento, "em pé" (upright)
            │   ├── inventory.ts        # quantidade e transferência de unidades entre inventários + spec
            │   ├── selection.ts        # seleção de vários tokens (principal, Shift, caixa, formação) + spec
            │   ├── race.ts             # raça/sub-raça na ficha: rótulos e modificadores de status (aplicar/desfazer) + spec
            │   ├── dice.ts             # rolagem 2d12/3d6, faixas de resultado, effectiveModifier (fixo + níveis das tags ligadas) + spec
            │   └── effects.ts          # buildFx: os 20 efeitos descritos como dados (partes SVG + animações)
            └── components/
                ├── map-stage/          # ORQUESTRADOR do mapa: zoom, pan, tela↔mundo, roteamento por ferramenta, WASD
                ├── map-layers/         # camadas dentro do "mundo": drawings, notes, fog, tokens, doors, walls, fx
                ├── scene-bar/          # barra superior: pastas e abas de cenas, vista isométrica (mestre)
                ├── levels-menu/        # painel de camadas do mapa (mestre, isométrica)
                ├── tool-bar/           # barra esquerda: ferramentas (TABLE_TOOLS) + submenus
                ├── draw-menu/ fog-menu/ fx-menu/  # submenus .glass das ferramentas Desenhar, Névoa e Efeitos
                ├── fx-picker/          # escolha de forma + cor de efeito (submenu e automação)
                ├── side-panel/         # barra direita: Chat, Fichas, Lore, Sons, Ações
                ├── chat-panel/         # aba Chat: mensagens e cartões de rolagem
                ├── sound-list/         # aba Sons: mixer
                ├── action-bar/         # barra inferior: 10 espaços de ações (teclas 1–0) + botão "Rolar"
                ├── quick-roll/         # painel da rolagem básica (dado, modificador, tags e etiquetas, não salvo)
                ├── entry-window/       # configuração da automação (dono, rolagem, tags, ícone, efeito)
                ├── character-sheet/    # FICHA de personagem e de NPC (abas; cards Básico, Status, Relações, Temas; Habilidades)
                ├── sheet-inventory/    # aba Inventário: lista de itens + cartão; equipado; no NPC, preços e compra (loja)
                ├── equipped-item-window/ # janela do cartão de um item equipado (lista "Equipados" da aba Ficha)
                ├── table-item-window/  # janela do cartão de um item criado na mesa (aba Lore)
                ├── sheet-notes/        # aba Anotações: caderno com páginas (RichTextEditor)
                ├── level-pips/         # seletor de nível 1–6 em losangos (relações e tags de tema)
                ├── token-editor/       # editor de tamanho, visão, barras e etiquetas
                ├── token-window/       # janela "Token" (duplo clique num token): único lugar das opções do token
                └── note-popover/       # edição de anotação junto ao marcador
```

Rotas (`app.routes.ts`, todas lazy):
- `''` (Shell) → `''` Home · `mesas` Tables · `worldbuild` Worldbuild do mundo aberto (aceita `?novo=<tipo>` e `?abrir=<id>`).
- `mesa/:id` → GameTablePage (tela cheia, **fora** do Shell)
- `**` → redireciona para `''`

---

## 5. Convenções de código

- **Componentes standalone**, nomes de arquivo sem sufixo (`home.ts`, classe `Home`) — padrão Angular 20+.
  Template em `.html` separado; templates muito curtos podem ser inline.
- **Estado com signals** (`signal`, `computed`, `effect`, `input`, `model`, `output`, `viewChild`).
  Injeção com `inject()`. Sem `NgModule`, sem RxJS onde signal resolve.
- **Controle de fluxo novo** no template: `@if`, `@for` (sempre com `track`), `@switch`, `@let`.
- **Estilo com Tailwind** nas classes do template. Evitar `.scss` por componente. Estilos globais só em `styles.scss`.
- **Classes do Tailwind dentro de strings TS** (ex.: `color: 'text-astral-300'` nos `*_META`) funcionam
  porque o Tailwind 4 escaneia os `.ts` — escreva a classe completa, nunca concatene partes.
- **Comentários em PT-BR**: JSDoc no topo de cada classe/serviço; `// --- Seção ---` para agrupar.
- **Textos da interface em PT-BR.**
- **Ícones:** `<mat-icon>` usa a fonte **Material Symbols Sharp** (configurado em `app.config.ts`).
  Use nomes de ícone do Material Symbols. Classe `.icon-filled` deixa o ícone preenchido.
- **Templates tipados (strict):** indexar `Record` com valor vindo de `let-` de `ng-template` dá erro TS7053.
  Solução padrão do projeto: método helper tipado no componente (`metaOf(item)`), não `$any`.
  Evite também spread (`[...]`) e `+`/`-` unários em expressões de template: use um método.
- **Lógica geométrica pura** (visão, colisão, layouts, simplificação) fica em `utils/`, sem Angular,
  sempre com `*.spec.ts` ao lado.
- **Dados novos nos modelos são opcionais**, com valor padrão na leitura (`normalizeState` em
  `game-table/state/table-state.ts`, `migrateTimeline` no `WorldbuildService`): dados salvos antigos sempre abrem.
- **Mutações da mesa são comandos** (preparação do multiplayer, ver `SPEC.md`): nova alteração do `TableState`
  = função pura `(estado, payload) → novo estado` no arquivo do assunto em `game-table/state/`, registrada em
  `TABLE_COMMANDS` e chamada pelo serviço com `this.dispatch('nome', payload)`. O payload é serializável: ids
  (`newId()`), horários e sorteios são gerados no serviço, nunca no comando. Nada de `state.update` direto.
  Blobs e o Worldbuild continuam no serviço. Comando sem efeito devolve o mesmo objeto.
- **Permissões e visibilidade novas** entram em `state/permissions.ts` ou `state/player-view.ts` (puras, com
  `Viewer`), nunca só no template: o servidor vai reaplicá-las.
- **Commits:** um por feature/fase, em branch separada da `main`, no formato Conventional Commits em PT-BR
  (`feat(mesa): …`, `fix(mesas): …`), com corpo explicando o que mudou.

### Armadilhas já resolvidas (não reintroduzir)

- **Effects que chamam métodos que leem signals** passam a rastreá-los. Use `untracked()` quando o effect
  deve reagir só a um signal (ex.: `GameTablePage` carrega a mesa só quando o `id` muda). Esse bug já
  causou recarga do estado a cada alteração.
- **Effects que carregam Blobs** (imagens/sons) devem depender de um `computed` estreito (só `blobId`,
  ou `mapKey` com `equal` customizado), senão recarregam a cada edição de qualquer outro item.
- **Effects assíncronos** (que fazem `await`) registram o `onCleanup` **antes** do `await` e marcam
  o carregamento como cancelado; depois do `await`, conferem o cancelamento antes de gravar o resultado.
  Sem isso, um arquivo lento da cena anterior aparece na cena nova.
- **Dados por usuário** (`WorldbuildService`): ao trocar de usuário, gravar as pendências na chave antiga
  antes de trocar, e descartar carregamentos que terminem depois da troca.
- Parâmetros de URL que criam dados (`?novo=`) são validados contra uma lista de tipos permitidos.
- **Duplo clique com captura de ponteiro:** após `setPointerCapture`, o `dblclick` nativo é redirecionado
  ao elemento que capturou e perde o alvo. Mapa e quadro da linha do tempo detectam o duplo clique
  manualmente (`isDoubleTap`: mesmo alvo, < 350ms, < 6px).
- **Cálculos caros só quando os dados mudam:** visão usa `computed` com igualdade por valor das origens
  (editar volume de um som não recalcula a névoa); a névoa redesenha agrupada em `requestAnimationFrame`.
- **Mutação de token por id** muda só a cena que o contém (outras cenas mantêm a referência).
- **Memória da névoa x troca de cena:** o tamanho do mapa chega à sessão junto com o id da cena
  (`worldSize`). Sem isso, enquanto o mapa novo carrega, a memória seria recriada com o tamanho
  da cena anterior e apagada. O efeito que grava a memória não se realimenta porque salvar a
  máscara não muda as origens de visão (computed com igualdade por valor).
- **Atalhos da mesa** são escutados na `window`: editores com teclas próprias (linha do tempo) chamam
  `stopPropagation()` em Delete/Esc para não disparar ações do mapa.
- `@theme static` no Tailwind é necessário porque `styles.scss` usa as variáveis `--color-*`.
- Host de componente: classe estática + `[class]` dinâmico se combinam (usado no `FloatingWindow`).
- Persistência com **debounce de 300ms** + `flush()` em `pagehide`/destroy — manter esse padrão.

---

## 6. Design system

**Tema:** espaço/universo expansivo — preto, azul e branco. Estética angular, inspirada em runas.

Tokens (`src/styles/tailwind.css`), use sempre por nome:

| Token | Uso |
|---|---|
| `ink-950 … ink-600` | Superfícies (preto azulado). 950 = fundo, 900/850 = painéis, 800/700 = elevação, 600 = bordas fortes |
| `astral-300 … 600` | Azul principal: ações, foco, seleção, item ativo |
| `star-300 … 500` | Branco estelar: títulos e realces |
| `slate-*` (Tailwind) | Texto secundário (cinza frio) |

- **Fontes:** `font-display` = **Tektur** (títulos), `font-sans` = **Chakra Petch** (todo o texto).
- **Cantos retos:** raios do Tailwind reduzidos no `@theme`; botões Material com 6px.
- **Utilitário `.glass`:** fundo translúcido + blur + borda azul sutil. Usar em barras, submenus e popovers sobre o mapa.
- **Utilitários da ficha** (`tailwind.css`): `sheet-card` (card), `sheet-title` (título do card), `sheet-label`
  (rótulo de campo em caixa alta) e `sheet-input` (campo de texto). A ficha usa container queries
  (`@container` + `@2xl:`/`@xl:`), porque o tamanho que importa é o da janela, não o da tela.
- **Fundo:** campo de estrelas e nebulosas só em CSS no `body` (sem imagens).
- **Animações:** `animate-fade-in` (entrada de painéis/janelas), `animate-ping-once` (ping no mapa),
  `animate-eq` (barras de equalizador do som tocando).
- **Interface dentro do mapa** (tokens, paredes, marcadores): tamanhos em px de tela convertidos com
  `ui(px) = px / scale`; textos com mínimo legível `legible(mundo, mínimoTela)`.
- Material: primary = `astral-400`, superfícies = `ink-*`, snackbar/menu/dialog escuros (overrides em `styles.scss`).
- Logo: `public/images/zehenia-banner.jpg` (banner 1024×572) e `zehenia-emblem.png` (monograma "Z", 96px);
  `public/favicon.png` (o mesmo "Z", 64px). Na barra lateral o nome aparece em duas linhas ("Crônicas de" / "Zehenia").

---

## 7. Regras de negócio

### Contas
- `APP_SETTINGS.requireAuth` (`core/config/app-settings.ts`), hoje **`false` = modo de teste**:
  `AuthService.user()` devolve um visitante fixo (`id: 'guest'`) quando ninguém está logado.
- `isLoggedIn()` = há usuário (real ou visitante). `isGuest()` = é o visitante.
- Contas reais: e-mail único (normalizado em minúsculas), senha com mínimo de 6 caracteres, hash SHA-256 (`dicetag:` + senha).
  Sessão = id do usuário em `localStorage['dicetag.session']`. **É provisório** — não é segurança real.
- Todos os dados são separados por usuário (o visitante tem os próprios dados).

### Mesas (`GameTablesService`)
- Campos: nome (obrigatório, até 60), sistema (texto livre com sugestões `GAME_SYSTEMS`), descrição (até 400),
  jogadores (1–20), cor de destaque (`TABLE_ACCENTS`), dono (`ownerId`) e **mundo** (`worldId`, escolhido na criação;
  ausente = o primeiro mundo, `DEFAULT_WORLD_ID`). Ao abrir a mesa, `GameTablePage` abre o mundo dela
  (`WorldsService.select`): a aba Lore, o bestiário, os itens do inventário e as raças vêm desse mundo.
- Lista mostra só as mesas do usuário atual, mais recentes primeiro.
- Excluir uma mesa apaga também `table-state:<id>` e os Blobs dela (mapas, áudios, imagens de token).

### Worldbuild (`WorldbuildService`)
- Tipos: `folder`, `document` (HTML do Tiptap em `content`), `timeline` (`events[]` + `links[]`), `image` (`blobId`),
  `item` (cartão: `blobId` opcional = imagem, nome, `description` e `tags: Tag[]`; a descrição também pode ser
  personalizada no inventário, como nome e etiquetas), `npc` (bestiário: `sheet` + `token` padrão;
  padrões em `npcSheetOf` / `npcTokenOf`), `race` (Raça: `traits` = características em texto, sem cor nem nível — raças antigas com `tags` valem pelo
  texto, `raceTraitsOf` —, imagens padrão opcionais `maleBlobId` /
  `femaleBlobId` — só guardadas por enquanto — e `statusMods` por barra de status; editor `RaceCard`, menu Criar →
  "Raça"; `setRaceImage` / `clearRaceImage`; excluir apaga as imagens).
- **Bestiário (NPCs):** aba **NPCs** do explorador (e "NPC" no menu Criar). A ficha base abre com a mesma
  `CharacterSheetView` + `WorldNpcStore` (diretiva `appWorldNpcSheet`), sem Relações nem Anotações. A aba
  **Habilidades** edita ali mesmo (nome, dados, modificador; ícone, tags e efeito só na mesa) as `WorldItem.abilities`
  do NPC, que valem em todas as mesas do mundo (ver "Ações automatizadas").
  Excluir um NPC do Worldbuild apaga a imagem e as imagens personalizadas do inventário dele.
- **Abas do explorador** (ícones com o nome na dica e contador; `LIST_VIEWS` em `explorer.ts`): **Arquivos** (árvore) e
  uma lista plana por tipo — Itens, NPCs, Raças, Linhas do tempo, Documentos e Mapas —, com busca e botão "Novo"
  (em Mapas, envia imagens); a aba Arquivos tem "Nova pasta". Valem no Worldbuild e na janela de explorador da mesa.
- **Itens do mundo:** aba **Itens** do explorador; itens também ficam na árvore. O cartão (`ItemCard`) é editável na janela do item e só
  leitura no inventário da ficha. Trocar a imagem usa `setImage` (apaga a anterior). Como os demais itens, aparecem
  na aba Lore da mesa e abrem em janela lá.
- **Mesa de trabalho** (página Worldbuild): as janelas abertas ficam salvas **por mundo** (`WorldbuildService.desk` /
  `saveDesk`, chave `desk:<usuário>:<mundo>`, debounce de 300ms + `flush`) e voltam iguais ao recarregar
  (`WindowManagerService.restore`; janelas de itens excluídos são descartadas). **Pastas** também abrem como janela
  ("Abrir na mesa de trabalho" no menu da pasta, `Explorer.folderWindows`): `FolderView` mostra o conteúdo e cada item
  clicado abre a janela dele. Na mesa de jogo as janelas não são salvas (e pastas não abrem como janela).
- Árvore por `parentId` (`null` = raiz). Ordenação: pastas primeiro, depois nome (pt-BR, numérico).
- Nomes padrão sem repetição na mesma pasta ("Novo documento 2"...).
- Mover: proibido mover uma pasta para dentro dela mesma ou de um descendente.
- Excluir pasta exclui todo o conteúdo e apaga os Blobs de imagem.
- Arquivos soltos no explorador: apenas imagens são aceitas.

### Mundos (`WorldsService`, `core/`)
- Cada usuário tem até **`MAX_WORLDS` = 2** mundos; cada um é um Worldbuild separado (`worldbuild:<usuário>:<mundo>`).
  O primeiro (`DEFAULT_WORLD_ID`, "Meu mundo") usa a chave antiga `worldbuild:<usuário>`: nada foi migrado.
  Lista em `worlds:<usuário>` (sem lista salva = só o primeiro); o mundo aberto fica em `localStorage dicetag.world.<usuário>`.
- `WorldbuildService` carrega sempre o **mundo aberto** (`activeId`): trocar de mundo grava as pendências na chave antiga.
- Página Worldbuild: seletor no cabeçalho do explorador (`Explorer.worldSwitcher`): trocar, criar (até 2), renomear,
  excluir. **Excluir** apaga itens e Blobs e só é permitido se **nenhuma mesa** se passa no mundo e se sobrar outro.
  Na mesa, o explorador não troca de mundo (é o da mesa). Barra lateral: seção "Mundo" lista os mundos (abre o Worldbuild).

### Linha do tempo (mapa mental)
- Eventos são cartões livres no quadro (`x`/`y` = canto superior esquerdo; tamanho fixo `TIMELINE_CARD`),
  ligados por `TimelineLink { id, from, to, label? }`. Data é **texto livre** (calendários de fantasia).
- **Migração** (só em `WorldbuildService`, ao carregar): eventos sem posição viram coluna e, se não havia
  `links`, cada evento é ligado ao seguinte.
- Duplo clique no fundo / "+ Evento" cria; alças "+" do cartão selecionado: clique cria evento conectado
  naquela direção, arrastar até outro cartão cria a seta. Shift ao mover alinha à grade (24px).
- Delete remove o evento (e suas setas) ou a seta selecionada. "Organizar automaticamente" = árvore da
  esquerda para a direita a partir dos eventos sem entrada (`treeLayout`).
- **Referências** (`TimelineEvent.refs` = ids de itens do mundo): na edição do evento, busca (sem acento) por qualquer
  item que não seja pasta nem a própria linha do tempo (`referenceCandidates`, `utils/references.ts` + spec) e chips com
  ×; no cartão, chips clicáveis abrem o item na janela dele (`TimelineEditor.openItem` → `open()` do Worldbuild ou da
  mesa). Itens excluídos somem das referências (`resolveReferences`). Na mesa, o jogador só abre o que o mestre revelou
  (`GameTablePage.open` não abre nada sem permissão e avisa).

### Mesa de jogo (`TableSessionService`, um por mesa aberta)
- **Cenas:** nome, mapa opcional (`blobId`), `gridSize` (20–300px, padrão 70), `showGrid`, `tokens`, `fog`,
  `walls`, `drawings`, `notes`. Uma cena ativa. Cena sem mapa = "papel quadriculado" de 2100×1400.
  Excluir a cena apaga os Blobs do mapa e das camadas.
- **Pastas de cenas** (`TableState.sceneFolders`, `Scene.folderId`; só o mestre organiza): na barra superior, cada
  pasta é um botão que abre a lista das cenas dela (a cena aberta aparece como "Pasta › Cena"); cenas fora de
  pastas são abas. Excluir a pasta mantém as cenas (saem da pasta). Renomear cena de pasta: campo no botão da pasta.

### Vista isométrica e camadas do mapa
- `Scene.isometric` (mestre, botão na barra superior): a vista vira `matrix(...)` = escala × `isoMatrix()` (gira 45° e
  achata, `ISO_SQUASH`) — puro em `utils/projection.ts`. **Toda conversão tela↔mundo usa `project`/`unproject`**
  e deslocamentos do mouse usam `screenDelta` (inversa da matriz); nunca dividir só pelo zoom. WASD move na
  direção da **tela**. Trocar a vista anima e reenquadra (`projectedBounds`).
- Elementos "de pé" (tokens, marcadores, botões de porta, efeitos cura/fumaça/teleporte) recebem
  `uprightMatrix` = inversa da vista × leve achatamento (`TOKEN_TILT`). Rótulos de texto (régua) ficam fora do mundo.
- **Camadas** (`Scene.levels`, acima do térreo; térreo = `blobId` da cena; máx. `MAX_MAP_LEVELS` = 5; tokens com
  `TokenPlacement.level`): controladas pelo mestre no painel "Camadas" da barra de ferramentas (só na isométrica).
  Imagens das camadas são esticadas ao tamanho do térreo. Camada **sem imagem = ar**: mostra a de baixo.
- **Quem vê o quê:** `Scene.playerLevel` (persistido, o "olho") = camada dos jogadores; o mestre olha qualquer
  uma (`currentLevel`, sessão; ao abrir a cena começa na dos jogadores). Excluir camada desce os tokens dela.
- **Desenho (map-stage):** todas as camadas são "mundos" empilhados com a mesma vista; a camada em foco fica
  parada e recebe ferramentas/névoa/desenhos/notas; as de baixo descem `LEVEL_GAP_SQUARES` por nível e escurecem.
  Acima: camadas **com mapa** mostram só o contorno da logo acima (sem tokens, para não confundir) e somem na 2D;
  camadas **sem mapa ("ar")** mostram os tokens voando nelas (na 2D, sobre o mapa). Tokens de camadas acima
  projetam **sombra** no "chão" sólido mais próximo abaixo. Transições só durante a troca (`animating`), para pan/zoom seguirem leves.
- Névoa, desenhos e anotações são da cena (desenhados na camada em foco); a visão usa os tokens da camada em foco.
- **Paredes e portas são de cada camada** (`Wall.level`, ausente = térreo): `session.walls()` traz só as da camada em
  foco (computed com igualdade por itens), `addWall` grava na camada em foco e só elas bloqueiam a visão. Excluir
  uma camada apaga as paredes dela e desce as de cima. Delete só remove a parede selecionada se ela for da camada em foco.
- Atalhos (mestre, isométrica): **PageUp/PageDown** sobem/descem o token selecionado (a vista acompanha) ou, sem
  seleção, a camada em foco.
- **Régua e visão:** 1 quadrado = **1,5 m** (`METERS_PER_SQUARE`).
- **Arquivos da mesa (`TableEntry`):** `character`, `npc` (com `token`), `sound` (`blobId`, `volume`, `loop`),
  `automation` (`role: 'gm' | 'player'` + `icon`). Excluir a ficha remove os tokens dela e apaga os Blobs.
- **Ficha x imagem:** o card Básico mostra a imagem; enviar ali usa `setTokenImage` (a imagem da ficha **é** a do
  token). Ficha, token e avatares cortam a imagem igual: `object-cover object-top` (retratos mostram o rosto).
- **Janela por tipo:** personagem, NPC e token de NPC (`npc:<id do token>`) abrem a ficha completa
  (`CharacterSheetView`, janela `sheet`, 880×700); NPC do bestiário aberto pelo explorador = janela `npc`
  (`appWorldNpcSheet`); automação abre a `EntryWindow`; item equipado (`equip:…`) abre a `EquippedItemWindow`. Sem permissão, `content()` → null (não abre).
- **Aba Lore = a árvore do mundo da mesa.** É o mesmo `Explorer` do Worldbuild, embutido no painel (não há cópia nem
  organização própria da mesa): o que o mestre cria, renomeia, move ou exclui ali (com confirmação) **muda o mundo**, e
  o que muda no Worldbuild aparece na mesa (mesmo `WorldbuildService`). Itens abrem nos mesmos editores.
- **Lore x jogadores:** cada pasta tem um **olho** que vale **só nesta mesa** (`TableState.lore.revealed` = ids das pastas
  do mundo, comando `toggleLoreReveal`; fechado por padrão). Revelar uma pasta revela tudo dentro dela, inclusive
  subpastas (no explorador, o olho delas fica aceso e esmaecido). O jogador vê o explorador em **só leitura**
  (`Explorer` `readonly` + filtro `visible`; pastas reveladas aparecem na raiz) e só abre o que está em pasta revelada
  (`canSeeLoreItem`, que sobe pelos `parentId`); abre em só leitura (`readonly` em DocumentEditor/RichTextEditor
  `editable`, TimelineEditor, ItemCard e na ficha do NPC do bestiário). Mesas antigas tinham pastas e nomes próprios na
  aba Lore: `normalizeState` os descarta e a mesa abre sem nada revelado.
- **Itens criados na mesa** (`TableState.items`) ficam na seção "Itens da mesa", abaixo do explorador, **visíveis a
  todos** (registro dos feitos dos jogadores). Abrem na janela `TableItemWindow` (tipo `table-item`): editável por
  quem criou e pelo mestre.
- **Grade:** escondida (menu da cena: "Remover grade") = tokens e paredes se movem livres; visível = alinham (Shift = livre).
  Não há botão nem atalho de grade na barra de ferramentas.
- **Papel (`role`)**: alternado manualmente na barra de ações (Mestre/Jogador, `session.setRole`) — não há permissões
  reais ainda. As regras de acesso às fichas já usam o papel + a conta (`canEdit`, `canOpen`…; ver "Ficha de NPC").
- **O que o jogador não vê/faz:** ferramenta **Névoa** (`ToolDef.gmOnly`, `toolAllowed`; sem atalhos F/W; trocar para
  jogador sai dela), **cenas** da barra superior (fica só voltar, título da mesa e os botões de painel, imersivo e tela
  cheia), abas **Sons** e **Ações** do painel direito, **mover/redimensionar/remover tokens** que não pode editar
  (`canEdit`: NPC só com controle; `MapStage.canMoveToken`, sem alça) e **criar ações pela barra de baixo** (cria na
  aba Habilidades da própria ficha).
- Estado de sessão **não persistido**: ferramenta ativa, papel, visibilidade das barras, janelas abertas,
  tokens selecionados, pincel, modo de parede, sons tocando, pilha de desfazer dos desenhos, efeitos na tela, tokens copiados (Ctrl+C).

### Ficha de personagem (`CharacterSheetView`, `TableEntry.sheet`)
- Personagens jogadores (`character`) e NPCs (ver "Ficha de NPC"). Dados em `CharacterSheet { race, subrace, labels,
  relations, themes, inventory, notes, eiros }`, lidos sempre por `session.sheetOf(entry)` (preenche padrões: **3 temas** e as **páginas fixas** das anotações) e
  gravados por `updateSheet(entryId, patch)`.
- **Aba Ficha** — cards em grade (container query):
  - **Básico:** imagem (= token), nome, raça, sub-raça, jogador dono ("Vincular à minha conta") e **rótulos** (texto livre, Enter adiciona).
    **Raça e sub-raça** são listas com as Raças do mundo aberto (na mesa, o mundo dela). Escolher aplica (`applyRace`, puro em `utils/race.ts` + spec):
    as características da raça viram **rótulos** e os `statusMods` somam ao **máximo** de Corpo/Mente/Espírito (o valor atual
    acompanha, entre 0 e o máximo; máximo ≥ 1). Raça e sub-raça somam; trocar ou limpar um campo desfaz só o que ele
    aplicou (`CharacterSheet.appliedRaces`; `raceRef`/`subraceRef` guardam a escolha). Fichas antigas com texto livre
    mostram o texto até uma raça ser escolhida. Características que já eram rótulos não são duplicadas nem removidas.
  - **Status:** três barras fixas **Corpo** (vermelha), **Mente** (verde), **Espírito** (azul) + **etiquetas** do personagem.
    Barras e etiquetas ficam no **token da ficha** (`TableEntry.token.bars/tags`), então aparecem no mapa.
    `withStatusBars` garante as três barras (ids `status-*`, rótulo e cor fixos) em personagens novos (`defaultToken`),
    antigos (`normalizeState`) e em toda gravação (`updateEntryToken`); a janela "Token" não as renomeia nem remove.
    Fichas novas (personagem e NPC) começam com as três barras em **24/24** (`DEFAULT_STATUS_MAX`).
    **Máximo das barras de status:** na mesa, só o mestre edita à mão (`canEditStatusMax` em `state/permissions.ts`;
    campo desabilitado na ficha e na janela "Token", `TokenEditor.lockStatusMax`). O jogador muda o valor atual, e o
    máximo dele só muda pela raça. Fora da mesa (bestiário no Worldbuild) quem edita a ficha edita o máximo.
  - **Relações:** nome, nível **1–6** (`LevelPips`) e descrição.
  - **Temas (3):** nome + tags com nível **1–6** e, embaixo, **Defeitos** (`flaws`) com nível **-1 a -6**
    (`LevelPips` com `negative`). Fichas antigas ganham `flaws: []` em `sheetOf`. Só personagem: **Objetivo** abaixo dos
    defeitos (`goal`, texto, + `goalProgress` de 0 a `GOAL_STEPS` = 5 marcadores; clicar no último aceso desmarca).
  - **Equipados** (personagem e NPC, abaixo dos temas, fora do `fieldset` para quem só lê também abrir): itens com
    `InventoryEntry.equipped` (caixa à esquerda de cada item na aba Inventário, `canEquip`). Clique (só na mesa) abre a
    janela `equip:<id da ficha>:<id no inventário>` (`EquippedItemWindow`: o mesmo `ItemCardView` do inventário,
    editável por quem edita a ficha). A linha do inventário (personalização x original) é montada por `inventoryRow`
    (`utils/inventory.ts`; as fontes vêm de `itemSources` em `sheet-inventory`). Transferir um item (`addOne`) não leva
    o "equipado".
  - **Estudos e Treinos** (só personagem, abaixo dos Equipados): `CharacterSheet.studies`, sempre `SHEET_STUDY_COUNT` = 3
    (`CharacterStudy { text, sa, sn }`; etiqueta sem cor). SN só o mestre edita. Ligado a uma rolagem (painel "Rolar" ou
    ação, via `studyTagsOf` em `rollTagsOf`, nível 0 = sem modificador): `studyGain` (só 2d12: 12+ → 1 SA, sucesso crítico → 2, **falha crítica → −1**, SA nunca abaixo de 0) e
    `trainStudy` (`utils/dice.ts`); `session.trainStudies` grava e, ao alcançar o SN, avisa no chat e devolve os nomes
    (`levelUps`) para o aviso "⭐ … subiu de nível!" de quem rolou.
- **Aba Inventário** (`SheetInventory`): `InventoryEntry { itemId, table? }` referencia um item do mundo (Worldbuild do
  mundo da mesa) ou da mesa (`TableState.items`); a lista mostra os nomes e, ao lado, o cartão **editável** (`ItemCardView`). Editar ali é
  **cópia sob demanda**: só o que mudou vai para a entrada (`name`, `tags`, `blobId`) e vale no lugar do original —
  o item do mundo e os outros inventários não mudam. "Voltar ao item original" limpa a personalização; imagens
  personalizadas são apagadas ao trocar, voltar, tirar o item ou excluir o personagem. "+ Item" busca itens das
  fontes (itens do mundo — o jogador só vê os revelados na aba Lore, `canSeeLoreItem` — e itens da mesa) ou cria um novo: o **mestre** cria
  no Worldbuild; o **jogador** cria só **nesta mesa** (`session.createTableItem`, `InventoryEntry.table`), nunca no
  Worldbuild. Fichas base do bestiário (`npc-base`/`world`) não usam itens da mesa. Item da mesa (`TableItem`, com
  `ownerUserId` e imagem própria): quem o criou e o mestre editam **o próprio item** pelo cartão do inventário
  (`canEditTableItem`, `updateTableItem`, `setTableItemImage`); os demais personalizam a cópia, como sempre. A origem de cada entrada é resolvida
  por `inventoryRow(entry, itemSources(...))`. Original excluído sem personalização aparece como "Item excluído".
  Etiquetas novas de item começam **verdes** (`ITEM_TAG_COLOR`).
- **Aba Anotações** (`SheetNotes`): caderno de texto rico em páginas (`NotePage { title, content }`). As páginas fixas
  **Background** e **Jornal** (`FIXED_NOTE_PAGES`, ids `background`/`journal`) ficam sempre no topo, sem excluir, mover
  nem renomear — garantidas por `withFixedNotePages` em `normalizeSheet` (a antiga "Página 1" vazia some). As demais
  são reordenadas arrastando (CDK `cdkDropList`, estilos globais `.cdk-drag-*` em `styles.scss`). O `RichTextEditor` lê o conteúdo só ao ser criado: a página aberta é renderizada num `@for` com
  `track` pelo id para recriar o editor ao trocar de página.
- **Aba Habilidades:** as automações do personagem (`automationsOf`), criadas por ele ou pelo mestre; "Usar" rola
  como a barra de ações (`onActionUsed`).
- **Tags na rolagem:** na configuração de uma ação de personagem, o jogador liga tags e defeitos dos temas
  (`RollConfig.attributes` = ids das tags). O **nível atual** é lido na hora (`tagLevelsOf` → `effectiveModifier`),
  então subir a tag na ficha atualiza todas as ações que a usam. Fórmulas exibidas usam `session.formulaOf(action)`.
  Tag apagada vale 0; trocar o dono da ação limpa as tags ligadas.
- **Etiquetas de itens equipados na rolagem** (ações e botão "Rolar"): `session.itemTagsOf` (id `itemTagId` =
  `item:<linha do inventário>:<etiqueta>`, valor = nível, sem nível 1); `rollTagsOf` = temas + itens, usado por
  `tagLevelsOf`. Ao mudar o inventário de uma ficha de entrada (`updateSheet` com `inventory`), `pruneItemTags` tira das
  ações dela as etiquetas de itens que não estão mais equipados (`keepValidItemTags`, puro + spec).
  Na ação, a etiqueta de item alterna desligada → bônus → **penalidade** (id com o prefixo `-`, `NEGATED_TAG_PREFIX`;
  `effectiveModifier` subtrai). Regras de sinal e de prefixo em `utils/dice.ts` (`baseTagId`, `attributeSign`).
  **Itens não somam ao total por padrão:** continuam selecionáveis e aparecem no cartão do chat, mas só entram no total
  (e no resultado) com a chave "Somar itens ao total" ligada — na ação `RollConfig.addItems` (`EntryWindow`), no "Rolar"
  um sinal do `QuickRoll` (não salvo, começa desligado). `effectiveModifier` só soma etiquetas de itens com `addItems`.
- **Cartão de rolagem no chat:** resultado (Sucesso, Falha…) grande no topo, dados e total no centro e, embaixo, o
  modificador do **personagem** (ícone `person`: fixo + temas + status) e o dos **itens** (ícone `shield`; fora do total,
  só o escudo fica apagado — o número nunca é riscado, para continuar legível). `RollResult.itemModifier` guarda o valor dos itens e `RollResult.itemsAdded` se ele
  entrou no total; rolagens antigas (sem `itemsAdded`) somaram os itens. `characterModifier` (puro) separa a parte do
  personagem nos dois casos.

### Ficha de NPC (mesma `CharacterSheetView`, `isNpc`)
- Igual à do personagem, **sem a aba Anotações e sem o card Relações** (abas Ficha, Inventário, Habilidades).
  NPCs também têm as barras de status (`hasSheet`). Ações de NPC também usam as tags dos temas.
- **Três níveis** (`SheetData.level`), todos pela mesma tela e pelo `SheetStore`:
  1. **Bestiário** (`world`): a ficha base no Worldbuild do mundo.
  2. **NPC da mesa** (`npc-base`): `TableEntry.worldNpcId` é **só uma referência** — ficha,
     imagem e token padrão vêm da base (`worldNpcOf`, `tokenOf`, `sheetOf`, `updateSheet`, `updateEntryToken` gravam
     lá); o nome acompanha o original (`entries` substitui pelo nome atual). Ações, controle e visibilidade são da
     mesa. "+" de NPCs no painel = bestiário (`session.bestiary`) ou "Novo NPC no Worldbuild". Tirar da mesa não apaga
     a base. NPCs antigos, com dados na entrada, continuam (`level: 'npc'`).
  3. **Token** (`npc-token`, id `npc:<id do token>`): ao colocar, o token copia a ficha (`TokenPlacement.sheet`, com
     imagens do inventário duplicadas), além de tamanho, barras e etiquetas; nome próprio em `TokenPlacement.name`.
     **Duplo clique** no token de NPC abre essa ficha (atalhos para "Opções do token" e "Ficha do NPC"). Alterar a
     cópia não mexe no NPC do painel nem no bestiário. Tokens antigos usam a ficha do NPC até a primeira alteração.
- **Loja e loot** só nos tokens e em NPCs antigos (`trades`); na ficha base o inventário é o "molde" das cópias.
- O bestiário é lido na sessão por `worldNpcMap` (computed com igualdade por referência dos NPCs): editar outros
  itens do Worldbuild não recalcula tokens e fichas da mesa.
- **Do mestre:** só o mestre cria, exclui e configura NPCs. "Controle" (topo da aba Ficha, só mestre) =
  `TableEntry.controllerUserId`: um jogador (conta dona de personagens da mesa, `session.players`) que passa a ver,
  editar e controlar o NPC (barra de ações ao selecionar o token, aba Ações, arrastar para o mapa).
- **Público, por token:** na ficha de cada **token** de NPC, botões "visível para os jogadores / só do mestre" na aba
  Ficha (`TokenPlacement.sheetPublic`) e na aba Inventário (`TokenPlacement.inventoryPublic`). Token **derrotado**
  (barra de status em 0) mostra o inventário aos jogadores sempre — só aquele token. O NPC do painel (ficha base) só
  abre para quem o edita: o jogador não o vê no painel; vê NPCs pelos tokens (duplo clique), só as abas liberadas,
  em **somente leitura**. Sem nada liberado, o duplo clique não abre nada.
- **Regras (único lugar: `game-table/state/permissions.ts`, puras; o `TableSessionService` só repassa o `Viewer`):** `canEdit` (mestre; NPC → só `controlsNpc`; personagens seguem livres),
  `sheetAccess(sheetId)` → `{ edit, sheet, inventory }`, `canOpenSheet`, `myNpcs`; o `actor` do jogador inclui o NPC
  que ele controla.
- **Somente leitura** = `<fieldset [disabled]>` em volta do conteúdo editável (desabilita inputs/botões nativos;
  `styles.scss` tira os eventos de mouse). A lista do inventário fica fora, para poder selecionar e comprar.
- **Loja:** `InventoryEntry.price` (Eiros, `CURRENCY`) na coluna ao lado dos itens do NPC (vazio = não está à venda).
  O personagem tem `CharacterSheet.eiros` (topo da aba Inventário). Jogador vendo a loja compra com o personagem dele
  (`session.buyer`: o selecionado ou o primeiro da conta): `buyItem` desconta os Eiros e passa **uma unidade**.
- **Quantidade:** `InventoryEntry.quantity` (ausente = 1), coluna "Qtd." em todos os inventários. Na loja, comprar ou
  lootear baixa 1 e a linha fica com 0 ("Esgotado", o mestre repõe); no personagem, a linha some ao zerar.
- **Transferência única** (`transferItem(from, inventoryId, to, cost)`): usada por compra, loot e "Dar para". Leva a
  personalização (nome, etiquetas, imagem) e nunca o preço; quem recebe empilha num item idêntico sem imagem própria
  ou ganha linha nova. Imagem: duplicada enquanto sobra unidade na origem; movida quando a linha some.
  Regras puras em `utils/inventory.ts` (`quantityOf`, `takeOne`, `addOne`) + spec.
- **NPC derrotado** (`isDown`: alguma barra de status em 0; `isDefeated`: na ficha ou em qualquer token dele): o token
  ganha um **X vermelho** e, com o inventário visível, o jogador vê **"Lootear"** em vez de "Comprar" (pega sem pagar).
- **"Dar para…"** (cartão do item, inventário de personagem, quem edita a ficha): lista os outros personagens da mesa
  e passa uma unidade com a personalização do dono.

### Ações automatizadas (automações)
- **Dono** (`TableEntry.ownerEntryId`): personagem = ação do jogador dele; NPC = ação do mestre para aquele NPC
  (vale para cada token dele); ausente = ação geral do mestre. O papel **deriva do dono** (`role` é legado:
  automações antigas sem dono aparecem como gerais do mestre). Excluir a ficha exclui as ações dela.
- **Habilidades de NPC do bestiário moram no NPC do mundo** (`WorldItem.abilities`, ações sem dono). Na mesa, cada
  NPC-referência ganha as dele como ações (`npcAbilitiesOf` em `state/npc-abilities.ts` + spec; `entries` as inclui com
  `ownerEntryId` = a referência; o mesmo NPC duas vezes na mesa: ficam com a primeira). `addEntry`/`updateEntry`/
  `removeEntry` gravam no NPC do mundo (`abilityHome`); trocar o dono move a ação entre mesa e mundo **com o mesmo id**.
  Tirar o NPC da mesa não apaga as habilidades. Ações antigas de NPC-referência gravadas na mesa são movidas para o NPC
  do mundo ao abrir a mesa (effect no `TableSessionService`, só com o NPC do mundo carregado).
- **Personagem x conta:** `ownerUserId` = conta que criou (ausente = de qualquer um); "Vincular à minha conta" na ficha.
- **Quem age** (`session.actor`, único lugar da regra): mestre = o que ele escolhe no menu "Agindo" da barra
  (`gmActing`): uma ficha **fixa** (não muda ao clicar em tokens), "Ações gerais" (null) ou "Token selecionado"
  (`ACT_SELECTION`, o padrão: segue a seleção); jogador = personagem dele ou NPC que controla, se selecionado, ou o
  primeiro personagem dele. `actorSheetId` = a ficha cujas tags valem (com o token do NPC que age selecionado, a cópia
  dele); "Usar" numa ficha rola com as tags daquela ficha (`useAction(action, sheetId)`), em nome dela no chat.
  A barra de baixo (`hotbar`, até 10; teclas 1–9 e 0) mostra as ações de quem age; espaço vazio (só mestre) cria
  uma ação já com esse dono; o jogador cria as dele na aba Habilidades da ficha.
- **Rolagem básica** ("Rolar", à direita da barra de baixo, mestre e jogador; `QuickRoll` num overlay do CDK): 2d12 ou
  3d6 + modificador escolhido na hora, **não salvo**. No 2d12 (o 3d6 usa só o modificador fixo) soma tags/defeitos dos temas, etiquetas dos itens equipados (só com "Somar itens ao total") e etiquetas de status da ficha de
  quem age (`actorSheetId`); cada etiqueta (de status ou de item) vira bônus ou penalidade (clique: + → − → fora; sem nível vale 1), regra
  pura em `quickModifier` (`utils/dice.ts`). `session.quickRoll` grava no chat ("Rolagem", ícone `casino`).
- **Rolagem** (`RollConfig { dice: '2d12' | '3d6', modifier, attributes? }`, puro em `utils/dice.ts`):
  2d12 → total < 0 falha crítica · < 12 falha · 12–17 sucesso parcial · 18–23 sucesso · **24+ sucesso crítico**;
  3d6 → até 9 azar · 10–12 neutro · 13+ sorte. O modificador passa sempre por `effectiveModifier(roll, levels)`:
  valor fixo + nível atual das tags dos temas ligadas em `roll.attributes` (defeitos subtraem).
  **3d6 não usa etiquetas** (`rollUsesTags`): nem temas, itens, status ou estudos; vale só o modificador fixo. As tags
  ligadas a uma ação que passou para 3d6 continuam salvas (valem de novo se ela voltar a 2d12), mas são ignoradas, e a
  `EntryWindow` e o `QuickRoll` escondem as etiquetas no 3d6.
- **Usar** (`useAction`): rola, grava no chat em nome de quem agiu, mostra um aviso e, se a ação tiver
  `effect`, arma o efeito (`armedFx`): ferramenta Efeitos ativa até o próximo arraste; depois volta à
  ferramenta anterior. Esc ou trocar de ferramenta desarma.
- Ícones: `AUTOMATION_ICONS` (Material Symbols).

### Chat (`TableState.chat`)
- `ChatMessage { author, role, userId, at, text? | roll? }`; guarda as últimas `MAX_CHAT_MESSAGES` (300).
- Texto em nome da conta ("Mestre" no papel de mestre); rolagens em nome do personagem/NPC que agiu.
- Aba à esquerda de Fichas, aberta por padrão; ponto azul quando chega mensagem com outra aba aberta.
  Enter envia, Shift+Enter quebra linha; o mestre pode limpar o chat.

### Efeitos especiais (ferramenta `fx`, tecla E)
- 20 formas em `FX_KINDS` (grupos `FX_GROUPS`): **Golpes** corte, garras, estocada, impacto · **Disparos** flecha,
  orbe, bola de fogo, raio, feixe, jato · **Área** explosão, onda, fumaça, meteoros, erupção, vórtice ·
  **Magia** cura, escudo, runa, teleporte. 13 cores por elemento (`FX_COLORS`).
- `radial: true` = arrastar do centro até a borda (não gira; "para cima" é para cima na tela; clique simples
  usa raio de 1,5 quadrado); os demais vão da origem ao alvo e giram na direção do arraste.
- **Arquitetura orientada a dados:** `buildFx(kind, color, from, to, ctx)` (puro, `utils/effects.ts`) devolve um
  `FxDrawing` (gradientes + partes SVG com atributos e animação). `fx-layer` só desenha as partes (diretiva
  `appFxPart` + template recursivo com prefixo `svg:`). Novo efeito = nova função no `BUILDERS`.
- Montado **uma vez** no lançamento (`castFx`, semente aleatória própria — `seededRandom`); a duração é calculada
  pelas partes (`lastEnd`) e o efeito sai da tela ao terminar. **Transitórios**, não são salvos.
- Animações genéricas `@keyframes fx-*` em `tailwind.css`, parametrizadas por variáveis CSS (`--dx/--dy`,
  `--s0/--s1`, `--o0`, `--rot`, `--sy`). **Todas começam invisíveis** (partes com atraso usam fill-mode `both`).
  `opacity` é da animação: translucidez fixa vai em `fill-opacity`/`stroke-opacity`.
- Giro/escala em SVG usam `transform-box: fill-box`; para girar em torno da origem, o grupo tem um círculo
  invisível centrado (caixa simétrica). Brilho com filtro `userSpaceOnUse` (linhas retas têm caixa de altura zero).
- Para conferir o visual, gere capturas congelando a animação: `fxCss(part, offsetMs, paused)` adianta/pausa
  cada parte (página HTML estática + Chrome headless `--screenshot`).

### Sons (mixer — `SoundMixerService`)
- Um `HTMLAudioElement` por som, independente de janelas (sons não abrem janela). Ao sair da mesa, tudo para.
- Volume efetivo = `volume` da faixa (padrão 0.8) × volume mestre (`TableState.soundMaster`, padrão 1).
  `volume`, `loop` (padrão `true`) e o mestre são persistidos; tocando/pausado não.
- Envio de vários arquivos `audio/*` (ou extensão de áudio) pelo botão ou arrastando para a aba Sons.

### Tokens — regra de vínculo (único lugar: `resolveToken` / `splitTokenPatch` em `state/tokens.ts`)
- `TableEntry.token` (ficha): `blobId`, `size` (0.5–6 quadrados; `TOKEN_SIZES` vai até 6 para criaturas enormes), `vision { enabled, range (m) }`, `speed?`, `bars`, `tags`
  (`TokenTag.level` opcional, ex.: Exaustão 2). Cores de barras/etiquetas: paleta `TOKEN_COLORS` ou cor livre.
  Padrão (`defaultToken`): tamanho 3 (`DEFAULT_TOKEN_SIZE`; fichas que já existiam mantêm o seu), visão 18 m (ligada para personagem, desligada para NPC).
- `Scene.tokens: TokenPlacement { id, entryId, x, y (centro), size?, vision?, bars?, tags? }`.
- **Personagem:** vinculado — tamanho, visão, barras e etiquetas vêm da ficha; alterar qualquer token altera a ficha e todos.
- **NPC:** ao ser colocado, copia tamanho, **visão**, barras, etiquetas **e a ficha** para a própria colocação (cada goblin
  tem seu PV, sua visão, seus temas e seu inventário — ver "Ficha de NPC"). Ligar a visão de um goblin não liga a dos
  outros. Tokens antigos sem `vision` usam a do NPC até a primeira alteração. "Usar como padrão do NPC" grava a visão também.
- Imagem e velocidade vêm **sempre da ficha** (inclusive para NPC).
- **Ficha x token:** clicar na ficha no painel abre só a ficha. Colocar no mapa **só arrastando** a ficha
  do painel. Duplo clique: personagem → janela "Token" (imagem, tamanho, visão, barras, etiquetas); NPC → ficha do
  token, com o botão "Opções do token" (na janela "Token", "Usar como padrão do NPC" → `saveTokenAsDefault` grava no
  token padrão — no bestiário, se for referência).
- Selecionar: clique seleciona, arrastar move com snap (Shift livre), alça redimensiona em passos de 0,5,
  Delete remove do mapa. **WASD/setas** com token selecionado: desliza na velocidade da ficha
  (`TokenSettings.speed`, padrão 2 quadrados/s, 0,5–12, editada na janela "Token"; vem sempre da ficha, inclusive no NPC; Shift ×2,5);
  ao soltar, alinha à grade se ela estiver visível. Movimento não colide com paredes.
- **Seleção de vários tokens** (regras puras em `utils/selection.ts`; na sessão, `selectedTokenIds` + o **principal**
  `selectedTokenId`, alterados só por `selectToken` / `toggleTokenSelection` / `selectTokens`):
  - arrastar no **fundo** com Selecionar desenha a **caixa de seleção** (pega os tokens da camada em foco que a conta pode
    mover, pelo centro na tela — vale na isométrica); Shift + caixa soma; clique no fundo limpa. Por isso o fundo **não
    move mais o mapa** em Selecionar: use o botão do meio ou a ferramenta Mover (M);
  - **Shift + clique** põe/tira um token da seleção; clique simples num token do grupo seleciona só ele;
  - arrastar um token selecionado move o **grupo** na mesma formação (o arrastado alinha à grade, os outros seguem o
    mesmo deslocamento; comando `moveTokens`); **WASD** move o grupo na velocidade do principal e alinha ao soltar;
    **Delete** remove todos; Esc limpa. O principal é o que tem a alça e o que janela, ficha, "quem age" e PageUp/PageDown usam.
  - `movableSelection` = selecionados da camada em foco que a conta pode mover (`canEdit`), o principal primeiro.
- **Copiar e colar** (`Ctrl+C` / `Ctrl+V`, só tokens que a conta edita — `canEdit`): `copyTokens` guarda na sessão cópias
  dos `TokenPlacement` selecionados como estavam (o principal primeiro); `MapStage.pasteTokens` cola o principal sob o mouse
  (fora do mapa: centro da área livre), alinhado à grade se visível, e os demais **na mesma formação**, na camada em foco e
  em qualquer cena da mesa; o grupo colado fica selecionado. A cópia é exata e independente (`copyPlacement` em
  `state/tokens.ts`: tamanho, visão, barras, etiquetas, nome, ficha do NPC, liberações), com id novo; as imagens do
  inventário do NPC são duplicadas. Personagem colado continua vinculado à ficha. Texto selecionado na página tem
  prioridade no Ctrl+C.

### Névoa de guerra e paredes
- `Scene.fog { enabled, memory? }` por cena; `Scene.walls`: `LineWall` (polilinha), `CircleWall` (vira 24 lados
  no cálculo) ou `DoorWall` (`points [a, b]`, `open`: fechada bloqueia, aberta não).
- Modos da ferramenta Névoa: linha (W), círculo, **porta** (arrastar de batente a batente), **editar paredes**
  (selecionar; arrastar corpo = move tudo, em passos de quadrado; arrastar alça = move o ponto/raio; Delete
  remove) e apagar.
- **Portas** têm camada própria, sempre visível; o botão no meio abre/fecha (ferramenta Selecionar, qualquer papel).
- **Memória da névoa** (`Scene.explored`, padrão ligada): áreas já vistas ficam reveladas e escurecidas;
  "Esquecer áreas exploradas" limpa. Trocar o mapa (outro tamanho) recomeça a memória.
- Visão: `computeVisibilityPolygon` (ray casting com ±ε nos vértices, limitado ao alcance) para cada token
  com visão ligada; recalcula só quando token, parede ou cena mudam.
- **Jogador:** névoa opaca, removida na união das áreas visíveis (e parcialmente nas exploradas); tokens
  fora da visão atual ficam ocultos (personagens sempre aparecem); anotações e portas aparecem se visíveis
  ou já exploradas (as anotações "só mestre" somem).
- **Mestre:** névoa a ~45% e contorno das áreas visíveis.
- Paredes visíveis durante a ferramenta Névoa ou sempre (opção do mestre). Linha: snap aos cantos da grade
  (Shift livre); Enter / duplo clique / clicar no ponto inicial finaliza; Esc cancela.

### Desenhos e anotações
- `Scene.drawings: Stroke { points (simplificados com RDP), color, width, opacity }`. Borracha remove os
  traços tocados ao soltar. **Ctrl+Z** desfaz a última ação de desenho da cena (pilha só na sessão, máx. 100).
- `Scene.notes: MapNote { x, y, title, text, color, gmOnly }`. Clique com a ferramenta Anotação cria;
  marcadores arrastáveis com Anotação ou Selecionar; clique abre o popover; Esc fecha.

### Atalhos da mesa (ignorados ao digitar)
`V` selecionar · `M` mover mapa · `R` régua · `P` ping · `D` desenhar · `F` névoa · `W` parede (névoa em modo linha) ·
`N` anotação · `E` efeitos especiais · `+`/`-` zoom · `1`–`0` ações · `\` modo imersivo · `Delete` remove os tokens selecionados (ou a parede
selecionada, no modo editar) · `Esc` cancela parede/fecha anotação/desarma efeito de ação/limpa seleção · `Enter` finaliza parede ·
`Ctrl+Z` desfaz desenho · **`Ctrl+C`/`Ctrl+V`** copia os tokens selecionados / cola sob o mouse · **`WASD`/setas** movem os tokens selecionados (nesse caso W/D não trocam de ferramenta) ·
**Shift + clique** soma/tira um token da seleção · arrastar no fundo (Selecionar) = caixa de seleção ·
**`PageUp`/`PageDown`** (mestre, isométrica) sobem/descem o token selecionado ou a camada em foco.
Botão do meio do mouse sempre move o mapa; roda do mouse = zoom no cursor.

---

## 8. Peças centrais da UX

### `FloatingWindow` (`shared/components/floating-window`)
Janela reutilizável usada no Worldbuild e na Mesa. Recursos: arrastar pela barra de título, redimensionar
(bordas direita, inferior e canto), **minimizar** (só a barra fica, estreita — largura do título + botões, até 22rem; o conteúdo é escondido, não destruído),
**maximizar** (duplo clique na barra), **fixar** (trava posição/tamanho), foco/z-index.
Usa `model()` para `geometry`, `maximized`, `minimized`, `pinned`. Limita-se ao elemento pai (`position: relative`).
No mobile (<768px), aberta ocupa a área inteira.

### `WindowManagerService` (`shared/services`)
Fornecido **por página** (`providers: [WindowManagerService]`). Uma janela por `id` de conteúdo; abrir de novo
foca/restaura. Abertura em cascata, tamanho por tipo. Padrão no template: `@for (win of windows.windows(); track win.id)`
com os pares `[x]`/`(xChange)` ligados a `windows.patch(win.id, {...})`.
Na mesa, janelas "Token" usam o id `token:<id da colocação>` e fecham sozinhas se o token sair do mapa.

### Layout da mesa (`game-table.html`) — camadas da página
0. `MapStage` ocupa a tela inteira.
1. Barras sobrepostas com `.glass`: topo (cenas), esquerda (ferramentas + submenus), direita (painel 320px), baixo (ações).
2. Camada de janelas (`pointer-events-none`; janelas com `pointer-events-auto`) acima das barras.
3. Abas nas bordas para reabrir barras escondidas.
O `MapStage` recebe `insets` para enquadrar o mapa só na área livre entre as barras.

### Mapa (`map-stage` + `map-layers/`)
- `map-stage` é o **orquestrador**: vista (`Viewport` + matriz 2D/isométrica), zoom/pan, conversão tela↔mundo,
  pilha de camadas do mapa e roteamento do ponteiro conforme a ferramenta. Camadas só desenham e emitem eventos
  (`tokenDown`, `noteDown`).
- Ordem no "mundo", de baixo para cima: **1** mapa · **2** grade · **3** desenhos · **4** notas · **5** névoa ·
  **6** tokens visíveis · **7** portas e paredes · **8** efeitos, régua e ping · **9** interface (popover, avisos — fora do mundo).
- Na ferramenta Selecionar, token ou anotação sob o cursor tem prioridade; o fundo desenha a caixa de seleção
  (o mapa se move com o botão do meio ou a ferramenta Mover).
- Mutações de cena passam pelo `TableSessionService` (`moveToken`, `updateToken`, `addWall`, `removeWall`,
  `addStroke`, `eraseStrokes`, `undoDrawing`, `addNote`…), que as aplica como comandos de `state/` (`dispatch`),
  sempre com o debounce de persistência.
- Teclas que dependem da ferramenta/seleção (Enter, Esc, Delete, WASD/setas) chegam via `MapStage.handleKey`;
  soltar tecla e perder o foco via `handleKeyUp` / `stopKeyMove`.

---

## 9. Persistência (IndexedDB, banco `dicetag`, store `kv`)

| Chave | Conteúdo |
|---|---|
| `users` | `StoredUser[]` |
| `tables` | `GameTable[]` (todas; filtradas por `ownerId`) |
| `worlds:<userId>` | `World[]` (mundos do usuário; ausente = só o primeiro) |
| `worldbuild:<userId>` | `WorldItem[]` do primeiro mundo (`DEFAULT_WORLD_ID`; itens, NPCs do bestiário, raças…) |
| `worldbuild:<userId>:<worldId>` | `WorldItem[]` dos outros mundos |
| `table-state:<tableId>` | `TableState` (cenas com tokens/névoa/memória/paredes/portas/desenhos/anotações/camadas/vista, pastas de cenas, cena ativa, arquivos — com a ficha do personagem em `sheet` e os NPCs como referência ao bestiário —, tokens de NPC com ficha própria, volume mestre, chat, organização da Lore, itens criados na mesa por jogadores) |
| `blob:<id>` | `Blob` de imagem/mapa/áudio/imagem de token |
| `desk:<userId>:<worldId>` | `OpenWindow[]`: janelas da mesa de trabalho do Worldbuild daquele mundo (posição, tamanho, estado) |
| `localStorage: dicetag.session` | id do usuário logado |
| `localStorage: dicetag.world.<userId>` | último mundo aberto pelo usuário |
| `localStorage: dicetag.sidebarCollapsed` | preferência da barra lateral |

O banco e as chaves do `localStorage` mantêm o prefixo `dicetag` (nome antigo do projeto) — assim como o prefixo
do hash das senhas — para não perder dados, sessões e contas já salvos. **Não renomear.**

**Armazenamento persistente:** `StorageService.requestPersistence()` chama `navigator.storage.persist()` (uma vez por
sessão) ao criar uma mesa ou um item do Worldbuild/Lore, para o navegador não apagar o IndexedDB quando falta espaço.
Não protege contra o usuário limpar os dados do site.

Para conectar um backend: o `StorageService` chave/valor e o `AuthService` local **não** são a interface de uma
API; serão trocados por repositórios por domínio fornecidos por injeção de dependência. Plano em `SPEC.md` §2.

---

## 10. Pendências e próximos passos sugeridos

As decisões para o back-end e o multiplayer estão no **`SPEC.md`**: sincronização por comandos e conflitos,
repositórios por domínio, servidor autoritativo (névoa, rolagens, permissões) e outras pendências
(exportar/importar, arquivos esquecidos ao excluir mesa, ciclo entre features, OnPush).

- Inventário sem peso; "Dar para" e compra passam uma unidade por vez; relações por nome livre (sem vínculo com
  fichas da mesa).
- Permissões de NPC dependem do papel escolhido na mesa; com backend, "jogador" deve vir da conta e do convite.
  A lista de jogadores para o controle do NPC vem dos donos dos personagens (`session.players`).
- Efeitos e chat ainda são locais (sem multiplayer, outros jogadores não veem); efeitos não saem do token automaticamente.
- Persistir janelas abertas, visibilidade das barras e pincel por mesa.
- Imagens de token substituídas durante a sessão só liberam a URL antiga ao sair da mesa (`BlobUrlService`).
- Névoa: visão só por token; portas sem tranca nem permissão (qualquer papel abre/fecha).
- Movimento de tokens (arrastar ou WASD) não colide com paredes.
- Ctrl+Z cobre só desenhos (não tokens, paredes ou anotações).
- Backend + multiplayer em tempo real; permissões reais de mestre/jogador; convite de jogadores.
- Mundos: limite fixo de 2 por usuário; trocar o mundo de uma mesa já criada ainda não é possível.
- Mural de notícias alimentado por API/CMS (`NewsService.posts`).
- Testes de componentes (hoje têm testes as funções puras de `utils/` e `state/`, as regras da ficha no modelo, a
  `FxLayer` e a fachada `TableSessionService`, num teste de integração).

---

## 11. Como trabalhar neste projeto (para o Claude Code)

1. Leia os arquivos envolvidos antes de editar; siga o padrão existente da feature.
2. Mudanças pequenas e focadas; não refatore o que não foi pedido.
3. Novos componentes: `features/<feature>/components/<nome>/<nome>.ts|.html`, standalone, Tailwind, comentários em PT-BR.
   Novas camadas do mapa: `features/game-table/components/map-layers/<nome>-layer/`.
4. Reaproveite `FloatingWindow`, `WindowManagerService`, `EmptyState`, `AutoFocus`, `ColorPicker`, `TagEditor`,
   `RichTextEditor`, `TokenEditor`, `LevelPips`, tokens, `.glass` e os utilitários `sheet-*`.
5. Valide com `npm run build` e `npx ng test --watch=false` ao final; corrija erros e avisos introduzidos.
6. Atualize este `CLAUDE.md` (e o `README.md`) quando mudar arquitetura, regras ou convenções.
