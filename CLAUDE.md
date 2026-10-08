# CLAUDE.md — Crônicas de Zehenia

Contexto do projeto para o Claude Code. Leia antes de qualquer alteração.
Idioma de trabalho: **português do Brasil** (respostas, comentários no código e textos da interface).

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
| Barra lateral global (navegação, **Lore geral**, "em breve", conta) | Pronto |
| **Lore geral** (`/lore`): lore oficial do mundo, global, mesma página/editores do Worldbuild | Pronto |
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
    │   │   └── news.model.ts
    │   ├── services/
    │   │   ├── storage.service.ts      # wrapper chave/valor do IndexedDB (get/set/delete)
    │   │   ├── auth.service.ts         # contas locais + visitante
    │   │   ├── game-tables.service.ts  # CRUD de mesas (excluir apaga table-state e blobs)
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
        │   ├── worldbuild.ts           # página: explorador + área de janelas (também serve a /lore)
        │   ├── lore.routes.ts          # rota /lore: página do worldbuild com LoreService
        │   ├── services/worldbuild.service.ts   # inclui a migração de linhas do tempo antigas; keyFor() define a chave
        │   ├── services/lore.service.ts         # Lore geral: estende WorldbuildService, chave global
        │   ├── directives/lore-scope.directive.ts  # appLoreScope: troca WorldbuildService → LoreService no elemento
        │   ├── utils/timeline-layout.ts         # layouts, setas e hit test do mapa mental + spec
        │   └── components/ explorer (abas Arquivos/Itens), document-editor, timeline-editor, image-viewer, item-card
        └── game-table/         # MESA DE JOGO (rota /mesa/:id, tela cheia, fora do Shell)
            ├── game-table.ts           # página: orquestra barras, janelas e atalhos
            ├── services/
            │   ├── table-session.service.ts  # estado da mesa + regra de vínculo dos tokens
            │   ├── sound-mixer.service.ts    # um HTMLAudioElement por som
            │   └── blob-url.service.ts       # object URLs com cache (imagens de token)
            ├── utils/                  # funções puras + specs Vitest
            │   ├── geometry.ts         # snap de token/canto, alça de tamanho, distâncias
            │   ├── visibility.ts       # visão por ray casting, paredes/portas → segmentos, ponto-em-polígono, doorSeen
            │   ├── walls.ts            # mover parede/alça, distância até a parede
            │   ├── fog-memory.ts       # máscara de áreas exploradas (bitset base64)
            │   ├── simplify.ts         # Ramer–Douglas–Peucker (traços)
            │   ├── projection.ts       # matriz 2D/isométrica, tela↔mundo, enquadramento, "em pé" (upright)
            │   ├── inventory.ts        # quantidade e transferência de unidades entre inventários + spec
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
                ├── action-bar/         # barra inferior: 10 espaços de ações (teclas 1–0)
                ├── entry-window/       # configuração da automação (dono, rolagem, tags, ícone, efeito)
                ├── character-sheet/    # FICHA de personagem e de NPC (abas; cards Básico, Status, Relações, Temas; Habilidades)
                ├── sheet-inventory/    # aba Inventário: lista de itens + cartão; no NPC, preços e compra (loja)
                ├── sheet-notes/        # aba Anotações: caderno com páginas (RichTextEditor)
                ├── level-pips/         # seletor de nível 1–6 em losangos (relações e tags de tema)
                ├── token-editor/       # editor de tamanho, visão, barras e etiquetas
                ├── token-window/       # janela "Token" (duplo clique num token): único lugar das opções do token
                └── note-popover/       # edição de anotação junto ao marcador
```

Rotas (`app.routes.ts`, todas lazy):
- `''` (Shell) → `''` Home · `mesas` Tables · `worldbuild` Worldbuild (aceita `?novo=<tipo>` e `?abrir=<id>`) ·
  `lore` Lore geral (`loadChildren` → `LORE_ROUTES`: mesmo componente `Worldbuild` com `LoreService` no lugar do `WorldbuildService`)
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
- **Dados novos nos modelos são opcionais**, com valor padrão na leitura (`normalizeState` no
  `TableSessionService`, `migrateTimeline` no `WorldbuildService`): dados salvos antigos sempre abrem.
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
- Todos os dados são separados por usuário (o visitante tem os próprios dados), **exceto a Lore geral** (global).

### Mesas (`GameTablesService`)
- Campos: nome (obrigatório, até 60), sistema (texto livre com sugestões `GAME_SYSTEMS`), descrição (até 400),
  jogadores (1–20), cor de destaque (`TABLE_ACCENTS`), dono (`ownerId`).
- Lista mostra só as mesas do usuário atual, mais recentes primeiro.
- Excluir uma mesa apaga também `table-state:<id>` e os Blobs dela (mapas, áudios, imagens de token).

### Worldbuild (`WorldbuildService`)
- Tipos: `folder`, `document` (HTML do Tiptap em `content`), `timeline` (`events[]` + `links[]`), `image` (`blobId`),
  `item` (cartão: `blobId` opcional = imagem, nome e `tags: Tag[]`).
- **Itens do mundo:** o explorador tem as abas **Arquivos** (árvore) e **Itens** (lista plana de `worldItems()`, com
  busca e "Novo item"); itens também ficam na árvore. O cartão (`ItemCard`) é editável na janela do item e só
  leitura no inventário da ficha. Trocar a imagem usa `setImage` (apaga a anterior). Como os demais itens, aparecem
  na aba Lore da mesa e abrem em janela lá.
- Árvore por `parentId` (`null` = raiz). Ordenação: pastas primeiro, depois nome (pt-BR, numérico).
- Nomes padrão sem repetição na mesma pasta ("Novo documento 2"...).
- Mover: proibido mover uma pasta para dentro dela mesma ou de um descendente.
- Excluir pasta exclui todo o conteúdo e apaga os Blobs de imagem.
- Arquivos soltos no explorador: apenas imagens são aceitas.

### Lore geral (`LoreService`)
- A lore oficial do mundo (o app é voltado a um mundo/sistema próprios). Mesmas regras do Worldbuild,
  mas numa chave **global** (`lore:global`), igual para todos os usuários. Ainda sem permissões: quem
  abre pode editar.
- `LoreService extends WorldbuildService` e só troca `title` e `keyFor()`. Página e editores são os
  mesmos: a rota `/lore` fornece `LoreService` como `WorldbuildService`; na mesa, a diretiva
  `appLoreScope` faz o mesmo no elemento do editor/explorador.

### Linha do tempo (mapa mental)
- Eventos são cartões livres no quadro (`x`/`y` = canto superior esquerdo; tamanho fixo `TIMELINE_CARD`),
  ligados por `TimelineLink { id, from, to, label? }`. Data é **texto livre** (calendários de fantasia).
- **Migração** (só em `WorldbuildService`, ao carregar): eventos sem posição viram coluna e, se não havia
  `links`, cada evento é ligado ao seguinte.
- Duplo clique no fundo / "+ Evento" cria; alças "+" do cartão selecionado: clique cria evento conectado
  naquela direção, arrastar até outro cartão cria a seta. Shift ao mover alinha à grade (24px).
- Delete remove o evento (e suas setas) ou a seta selecionada. "Organizar automaticamente" = árvore da
  esquerda para a direita a partir dos eventos sem entrada (`treeLayout`).

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
- Névoa, paredes, desenhos e anotações são da cena (desenhados na camada em foco); a visão usa os tokens da camada em foco.
- Atalhos (mestre, isométrica): **PageUp/PageDown** sobem/descem o token selecionado (a vista acompanha) ou, sem
  seleção, a camada em foco.
- **Régua e visão:** 1 quadrado = **1,5 m** (`METERS_PER_SQUARE`).
- **Arquivos da mesa (`TableEntry`):** `character`, `npc` (com `token`), `sound` (`blobId`, `volume`, `loop`),
  `automation` (`role: 'gm' | 'player'` + `icon`). Excluir a ficha remove os tokens dela e apaga os Blobs.
- **Ficha x imagem:** personagem (card Básico) e NPC (topo da janela) mostram a imagem; enviar ali usa
  `setTokenImage` (a imagem da ficha **é** a do token).
- **Janela por tipo:** personagem e NPC abrem a ficha completa (`CharacterSheetView`, janela `sheet`, 880×700);
  automação abre a `EntryWindow`. NPC que o jogador não pode abrir não gera janela (`content()` → null).
- **Lore** não é duplicada: a aba Lore lista os itens (exceto pastas) da **Lore geral** (marcados com
  `auto_stories`) e do **Worldbuild** do usuário e os abre com os mesmos editores.
  "Abrir Lore geral" / "Abrir pastas do Worldbuild" abrem o `Explorer` numa janela (`lore:explorer` /
  `worldbuild:explorer`) **sem sair da mesa**.
- **Organização da Lore por mesa (`TableState.lore`):** pastas próprias da mesa (um nível, `LoreFolder`) e
  ajustes por item (`LoreItemOverride { name?, folderId?, hidden? }`). Renomear muda só o nome **nesta mesa**
  (vazio = volta ao original; o título da janela usa `loreName`); a lixeira **esconde** o item desta mesa
  ("Restaurar N itens" traz de volta); excluir pasta devolve os itens à raiz. **Nunca** altera nem apaga o
  original. Itens entram nas pastas arrastando.
- **Grade:** escondida (G ou menu da cena) = tokens e paredes se movem livres; visível = alinham (Shift = livre).
- **Papel (`role`)**: alternado manualmente na barra de ações (Mestre/Jogador) — não há permissões reais ainda.
  As regras de acesso às fichas já usam o papel + a conta (`canEdit`, `canOpen`…; ver "Ficha de NPC").
- Estado de sessão **não persistido**: ferramenta ativa, papel, visibilidade das barras, janelas abertas,
  token selecionado, pincel, modo de parede, sons tocando, pilha de desfazer dos desenhos, efeitos na tela.

### Ficha de personagem (`CharacterSheetView`, `TableEntry.sheet`)
- Personagens jogadores (`character`) e NPCs (ver "Ficha de NPC"). Dados em `CharacterSheet { race, subrace, labels,
  relations, themes, inventory, notes, eiros }`, lidos sempre por `session.sheetOf(entry)` (preenche padrões: **3 temas** e **1+ página**) e
  gravados por `updateSheet(entryId, patch)`.
- **Aba Ficha** — cards em grade (container query):
  - **Básico:** imagem (= token), nome, raça, sub-raça, jogador dono ("Vincular à minha conta") e **rótulos** (texto livre, Enter adiciona).
  - **Status:** três barras fixas **Corpo** (vermelha), **Mente** (verde), **Espírito** (azul) + **etiquetas** do personagem.
    Barras e etiquetas ficam no **token da ficha** (`TableEntry.token.bars/tags`), então aparecem no mapa.
    `withStatusBars` garante as três barras (ids `status-*`, rótulo e cor fixos) em personagens novos (`defaultToken`),
    antigos (`normalizeState`) e em toda gravação (`updateEntryToken`); a janela "Token" não as renomeia nem remove.
  - **Relações:** nome, nível **1–6** (`LevelPips`) e descrição.
  - **Temas (3):** nome + tags com nível **1–6** e, embaixo, **Defeitos** (`flaws`) com nível **-1 a -6**
    (`LevelPips` com `negative`). Fichas antigas ganham `flaws: []` em `sheetOf`.
- **Aba Inventário** (`SheetInventory`): `InventoryEntry { itemId, global? }` referencia um item do mundo (Worldbuild do
  usuário ou Lore geral); a lista mostra os nomes e, ao lado, o cartão **editável** (`ItemCardView`). Editar ali é
  **cópia sob demanda**: só o que mudou vai para a entrada (`name`, `tags`, `blobId`) e vale no lugar do original —
  o item do mundo e os outros inventários não mudam. "Voltar ao item original" limpa a personalização; imagens
  personalizadas são apagadas ao trocar, voltar, tirar o item ou excluir o personagem. "+ Item" busca itens das duas
  fontes ou cria um novo no Worldbuild. Original excluído sem personalização aparece como "Item excluído".
  Etiquetas novas de item começam **verdes** (`ITEM_TAG_COLOR`).
- **Aba Anotações** (`SheetNotes`): caderno de texto rico em páginas (`NotePage { title, content }`); a última página
  não é excluída. O `RichTextEditor` lê o conteúdo só ao ser criado: a página aberta é renderizada num `@for` com
  `track` pelo id para recriar o editor ao trocar de página.
- **Aba Habilidades:** as automações do personagem (`automationsOf`), criadas por ele ou pelo mestre; "Usar" rola
  como a barra de ações (`onActionUsed`).
- **Tags na rolagem:** na configuração de uma ação de personagem, o jogador liga tags e defeitos dos temas
  (`RollConfig.attributes` = ids das tags). O **nível atual** é lido na hora (`tagLevelsOf` → `effectiveModifier`),
  então subir a tag na ficha atualiza todas as ações que a usam. Fórmulas exibidas usam `session.formulaOf(action)`.
  Tag apagada vale 0; trocar o dono da ação limpa as tags ligadas.

### Ficha de NPC (mesma `CharacterSheetView`, `isNpc`)
- Igual à do personagem, **sem a aba Anotações e sem o card Relações** (abas Ficha, Inventário, Habilidades).
  NPCs também têm as barras de status (`hasSheet`); na ficha, barras e etiquetas são o **padrão dos próximos tokens**
  (cada token colocado continua independente). Ações de NPC também usam as tags dos temas dele.
- **Do mestre:** só o mestre cria, exclui e configura NPCs. "Controle" (topo da aba Ficha, só mestre) =
  `TableEntry.controllerUserId`: um jogador (conta dona de personagens da mesa, `session.players`) que passa a ver,
  editar e controlar o NPC (barra de ações ao selecionar o token, aba Ações, arrastar para o mapa).
- **Público:** botões "visível para os jogadores / só do mestre" na aba Ficha (`sheetPublic`) e na aba Inventário
  (`inventoryPublic`). Jogador sem permissão não vê o NPC no painel, não abre a ficha e o duplo clique no token não abre
  nada; com partes públicas, vê só essas abas em **somente leitura**.
- **Regras (único lugar, `TableSessionService`):** `canEdit` (mestre; NPC → só `controlsNpc`; personagens seguem livres),
  `canViewSheet`, `canViewInventory`, `canOpen`, `myNpcs`; o `actor` do jogador inclui o NPC que ele controla.
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
- **Personagem x conta:** `ownerUserId` = conta que criou (ausente = de qualquer um); "Vincular à minha conta" na ficha.
- **Quem age** (`session.actor`, único lugar da regra): mestre = ficha do token selecionado (NPC **ou** personagem)
  ou, sem seleção, ninguém (ações gerais); jogador = personagem dele selecionado ou o primeiro personagem dele.
  A barra de baixo (`hotbar`, até 10; teclas 1–9 e 0) mostra as ações de quem age; espaço vazio cria uma ação
  já com esse dono.
- **Rolagem** (`RollConfig { dice: '2d12' | '3d6', modifier, attributes? }`, puro em `utils/dice.ts`):
  2d12 → total < 0 falha crítica · < 12 falha · < 17 sucesso parcial · < 24 sucesso · **24+ sucesso crítico**;
  3d6 → até 9 azar · 10–12 neutro · 13+ sorte. O modificador passa sempre por `effectiveModifier(roll, levels)`:
  valor fixo + nível atual das tags dos temas ligadas em `roll.attributes` (defeitos subtraem).
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

### Tokens — regra de vínculo (único lugar: `resolveToken` / `updateToken`)
- `TableEntry.token` (ficha): `blobId`, `size` (0.5–4 quadrados), `vision { enabled, range (m) }`, `speed?`, `bars`, `tags`
  (`TokenTag.level` opcional, ex.: Exaustão 2). Cores de barras/etiquetas: paleta `TOKEN_COLORS` ou cor livre.
  Padrão (`defaultToken`): tamanho 1, visão 18 m (ligada para personagem, desligada para NPC).
- `Scene.tokens: TokenPlacement { id, entryId, x, y (centro), size?, bars?, tags? }`.
- **Personagem:** vinculado — tamanho, barras e etiquetas vêm da ficha; alterar qualquer token altera a ficha e todos.
- **NPC:** ao ser colocado, copia tamanho, barras e etiquetas para a própria colocação (cada goblin tem seu PV).
- Imagem e visão vêm **sempre da ficha** (inclusive para NPC).
- **Ficha x token:** clicar na ficha no painel abre só a ficha. Colocar no mapa **só arrastando** a ficha
  do painel. Opções do token **só** pelo duplo clique no token (janela "Token": imagem, tamanho, visão,
  barras, etiquetas e, para NPC, "Usar como padrão do NPC" → `saveTokenAsDefault`).
- Selecionar: clique seleciona, arrastar move com snap (Shift livre), alça redimensiona em passos de 0,5,
  Delete remove do mapa. **WASD/setas** com token selecionado: desliza na velocidade da ficha
  (`TokenSettings.speed`, padrão 2 quadrados/s, 0,5–12, editada na janela "Token"; como a visão, vem sempre da ficha; Shift ×2,5);
  ao soltar, alinha à grade se ela estiver visível. Movimento não colide com paredes.

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
`N` anotação · `E` efeitos especiais · `G` grade · `+`/`-` zoom · `1`–`0` ações · `\` modo imersivo · `Delete` remove o token (ou a parede,
no modo editar) selecionado · `Esc` cancela parede/fecha anotação/desarma efeito de ação/limpa seleção · `Enter` finaliza parede ·
`Ctrl+Z` desfaz desenho · **`WASD`/setas** movem o token selecionado (nesse caso W/D não trocam de ferramenta) ·
**`PageUp`/`PageDown`** (mestre, isométrica) sobem/descem o token selecionado ou a camada em foco.
Botão do meio do mouse sempre move o mapa; roda do mouse = zoom no cursor.

---

## 8. Peças centrais da UX

### `FloatingWindow` (`shared/components/floating-window`)
Janela reutilizável usada no Worldbuild e na Mesa. Recursos: arrastar pela barra de título, redimensionar
(bordas direita, inferior e canto), **minimizar** (só a barra fica; o conteúdo é escondido, não destruído),
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
- Na ferramenta Selecionar, token ou anotação sob o cursor tem prioridade; o fundo move o mapa.
- Mutações de cena passam pelo `TableSessionService` (`moveToken`, `updateToken`, `addWall`, `removeWall`,
  `addStroke`, `eraseStrokes`, `undoDrawing`, `addNote`…), sempre com o debounce de persistência.
- Teclas que dependem da ferramenta/seleção (Enter, Esc, Delete, WASD/setas) chegam via `MapStage.handleKey`;
  soltar tecla e perder o foco via `handleKeyUp` / `stopKeyMove`.

---

## 9. Persistência (IndexedDB, banco `dicetag`, store `kv`)

| Chave | Conteúdo |
|---|---|
| `users` | `StoredUser[]` |
| `tables` | `GameTable[]` (todas; filtradas por `ownerId`) |
| `worldbuild:<userId>` | `WorldItem[]` (inclui os itens do mundo com cartão) |
| `lore:global` | `WorldItem[]` da Lore geral (igual para todos) |
| `table-state:<tableId>` | `TableState` (cenas com tokens/névoa/memória/paredes/portas/desenhos/anotações/camadas/vista, pastas de cenas, cena ativa, arquivos — com a ficha do personagem em `sheet` —, volume mestre, chat, organização da Lore) |
| `blob:<id>` | `Blob` de imagem/mapa/áudio/imagem de token |
| `localStorage: dicetag.session` | id do usuário logado |
| `localStorage: dicetag.sidebarCollapsed` | preferência da barra lateral |

O banco e as chaves do `localStorage` mantêm o prefixo `dicetag` (nome antigo do projeto) — assim como o prefixo
do hash das senhas — para não perder dados, sessões e contas já salvos. **Não renomear.**

Para conectar um backend no futuro: trocar `StorageService` e `AuthService` mantendo as interfaces públicas.

---

## 10. Pendências e próximos passos sugeridos

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
- Lore geral: hoje qualquer usuário edita; com backend, só o dono do mundo deve editar (os demais só leem).
- Mural de notícias alimentado por API/CMS (`NewsService.posts`).
- Testes de componentes (hoje só as funções puras de `utils/`, as regras da ficha no modelo e a `FxLayer` têm testes).

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
