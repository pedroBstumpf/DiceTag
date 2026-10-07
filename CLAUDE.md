# CLAUDE.md — DiceTag

Contexto do projeto para o Claude Code. Leia antes de qualquer alteração.
Idioma de trabalho: **português do Brasil** (respostas, comentários no código e textos da interface).

---

## 1. Resumo executivo

**DiceTag** é um VTT (Virtual Tabletop): um aplicativo web para jogar RPG de mesa online com amigos.
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
| Worldbuild (pastas, documentos rich text, **linha do tempo em mapa mental**, mapas/imagens) | Pronto |
| **Mesa de jogo** (mapa em camadas, 4 barras escondíveis, janelas flutuantes) | Pronto |
| Sons: **mixer** com faixas simultâneas, volume/repetição por faixa e volume mestre | Pronto |
| **Tokens** (imagem, tamanho, visão, barras e etiquetas com cor/nível; vínculo personagem/NPC; WASD) | Pronto |
| **Névoa de guerra + paredes + portas** (visão por ray casting, por papel, memória de áreas exploradas) | Pronto |
| **Pincel** (desenho livre, borracha, Ctrl+Z) e **anotações** no mapa | Pronto |
| Fichas de personagem/NPC | **Placeholder** (não estruturar sem pedido); só nome + imagem (= imagem do token); demais opções do token ficam só no mapa |
| Automações (habilidades/dados) | **Placeholder** (nome + ícone; aparecem na barra de ações) |
| Rolagem de dados | Não iniciado |
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
- **Tiptap 3** (editor rich text dos documentos)
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
  O inicial está em ~790kB (perto do aviso): evite importar coisas pesadas fora das rotas lazy.

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
    │   │   ├── table-session.model.ts  # Scene, TableEntry, TableState, tokens, paredes, traços, anotações, constantes
    │   │   ├── world-item.model.ts     # WorldItem, TimelineEvent, TimelineLink, WORLD_ITEM_META, TIMELINE_COLORS
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
        │   └── components/ explorer, document-editor, timeline-editor, image-viewer
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
            │   └── simplify.ts         # Ramer–Douglas–Peucker (traços)
            └── components/
                ├── map-stage/          # ORQUESTRADOR do mapa: zoom, pan, tela↔mundo, roteamento por ferramenta, WASD
                ├── map-layers/         # camadas dentro do "mundo": drawings, notes, fog, tokens, doors, walls
                ├── scene-bar/          # barra superior: cenas/mapas
                ├── tool-bar/           # barra esquerda: ferramentas (TABLE_TOOLS) + submenus
                ├── draw-menu/ fog-menu/  # submenus .glass das ferramentas Desenhar e Névoa
                ├── side-panel/         # barra direita: Fichas, Lore, Sons, Automações
                ├── sound-list/         # aba Sons: mixer
                ├── action-bar/         # barra inferior: 10 espaços de ações (teclas 1–0)
                ├── entry-window/       # ficha de personagem/NPC/automação (placeholder)
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
- **Fundo:** campo de estrelas e nebulosas só em CSS no `body` (sem imagens).
- **Animações:** `animate-fade-in` (entrada de painéis/janelas), `animate-ping-once` (ping no mapa),
  `animate-eq` (barras de equalizador do som tocando).
- **Interface dentro do mapa** (tokens, paredes, marcadores): tamanhos em px de tela convertidos com
  `ui(px) = px / scale`; textos com mínimo legível `legible(mundo, mínimoTela)`.
- Material: primary = `astral-400`, superfícies = `ink-*`, snackbar/menu/dialog escuros (overrides em `styles.scss`).
- Logo: `public/images/dicetag-banner.webp` (banner) e `dicetag-emblem.webp` (ícone 96px); `public/favicon.png`.

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
- Tipos: `folder`, `document` (HTML do Tiptap em `content`), `timeline` (`events[]` + `links[]`), `image` (`blobId`).
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
  Excluir a cena apaga o Blob do mapa.
- **Régua e visão:** 1 quadrado = **1,5 m** (`METERS_PER_SQUARE`).
- **Arquivos da mesa (`TableEntry`):** `character`, `npc` (com `token`), `sound` (`blobId`, `volume`, `loop`),
  `automation` (`role: 'gm' | 'player'` + `icon`). Excluir a ficha remove os tokens dela e apaga os Blobs.
- **Ficha x imagem:** personagem/NPC mostra a imagem no topo da ficha; enviar ali usa `setTokenImage`
  (a imagem da ficha **é** a do token).
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
  A barra de ações mostra as automações do papel atual (até 10; teclas 1–9 e 0). Espaço vazio cria uma automação.
- Usar uma ação hoje só mostra um aviso (snackbar). Rolagem real ainda não existe.
- Estado de sessão **não persistido**: ferramenta ativa, papel, visibilidade das barras, janelas abertas,
  token selecionado, pincel, modo de parede, sons tocando, pilha de desfazer dos desenhos.

### Sons (mixer — `SoundMixerService`)
- Um `HTMLAudioElement` por som, independente de janelas (sons não abrem janela). Ao sair da mesa, tudo para.
- Volume efetivo = `volume` da faixa (padrão 0.8) × volume mestre (`TableState.soundMaster`, padrão 1).
  `volume`, `loop` (padrão `true`) e o mestre são persistidos; tocando/pausado não.
- Envio de vários arquivos `audio/*` (ou extensão de áudio) pelo botão ou arrastando para a aba Sons.

### Tokens — regra de vínculo (único lugar: `resolveToken` / `updateToken`)
- `TableEntry.token` (ficha): `blobId`, `size` (0.5–4 quadrados), `vision { enabled, range (m) }`, `bars`, `tags`
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
  Delete remove do mapa. **WASD/setas** com token selecionado: desliza ~2 quadrados/s (Shift acelera);
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
`N` anotação · `G` grade · `+`/`-` zoom · `1`–`0` ações · `\` modo imersivo · `Delete` remove o token (ou a parede,
no modo editar) selecionado · `Esc` cancela parede/fecha anotação/limpa seleção · `Enter` finaliza parede ·
`Ctrl+Z` desfaz desenho · **`WASD`/setas** movem o token selecionado (nesse caso W/D não trocam de ferramenta).
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
- `map-stage` é o **orquestrador**: vista (`Viewport`), zoom/pan, conversão tela↔mundo e roteamento do
  ponteiro conforme a ferramenta. Camadas só desenham e emitem eventos (`tokenDown`, `noteDown`).
- Ordem no "mundo", de baixo para cima: **1** mapa · **2** grade · **3** desenhos · **4** notas · **5** névoa ·
  **6** tokens visíveis · **7** portas e paredes · **8** régua e ping · **9** interface (popover, avisos — fora do mundo).
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
| `worldbuild:<userId>` | `WorldItem[]` |
| `lore:global` | `WorldItem[]` da Lore geral (igual para todos) |
| `table-state:<tableId>` | `TableState` (cenas com tokens/névoa/memória/paredes/portas/desenhos/anotações, cena ativa, arquivos, volume mestre, organização da Lore) |
| `blob:<id>` | `Blob` de imagem/mapa/áudio/imagem de token |
| `localStorage: dicetag.session` | id do usuário logado |
| `localStorage: dicetag.sidebarCollapsed` | preferência da barra lateral |

Para conectar um backend no futuro: trocar `StorageService` e `AuthService` mantendo as interfaces públicas.

---

## 10. Pendências e próximos passos sugeridos

- Estruturar **ficha de personagem/NPC** (aguardar definição do dono: sistema genérico ou por sistema).
- **Rolador de dados** + automações reais (fórmulas como `1d20+5`, alvos, efeitos) ligadas à barra de ações.
- Persistir janelas abertas, visibilidade das barras e pincel por mesa.
- Imagens de token substituídas durante a sessão só liberam a URL antiga ao sair da mesa (`BlobUrlService`).
- Névoa: visão só por token; portas sem tranca nem permissão (qualquer papel abre/fecha).
- Movimento de tokens (arrastar ou WASD) não colide com paredes.
- Ctrl+Z cobre só desenhos (não tokens, paredes ou anotações).
- Backend + multiplayer em tempo real; permissões reais de mestre/jogador; convite de jogadores.
- Lore geral: hoje qualquer usuário edita; com backend, só o dono do mundo deve editar (os demais só leem).
- Mural de notícias alimentado por API/CMS (`NewsService.posts`).
- Testes de componentes (hoje só as funções puras de `utils/` têm testes).

---

## 11. Como trabalhar neste projeto (para o Claude Code)

1. Leia os arquivos envolvidos antes de editar; siga o padrão existente da feature.
2. Mudanças pequenas e focadas; não refatore o que não foi pedido.
3. Novos componentes: `features/<feature>/components/<nome>/<nome>.ts|.html`, standalone, Tailwind, comentários em PT-BR.
   Novas camadas do mapa: `features/game-table/components/map-layers/<nome>-layer/`.
4. Reaproveite `FloatingWindow`, `WindowManagerService`, `EmptyState`, `AutoFocus`, `ColorPicker`, `TokenEditor`, tokens e `.glass`.
5. Valide com `npm run build` e `npx ng test --watch=false` ao final; corrija erros e avisos introduzidos.
6. Atualize este `CLAUDE.md` (e o `README.md`) quando mudar arquitetura, regras ou convenções.
