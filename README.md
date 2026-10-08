# Crônicas de Zehenia

Mesa virtual (VTT) para jogar RPG de mesa online com amigos no mundo de Zehenia (projeto antes chamado DiceTag).
Angular 21 · Angular Material (M3) · Tailwind CSS 4 · Tiptap (editor de texto) · Vitest.

Visual: tema espacial (preto, azul e branco), fontes angulares inspiradas em runas
(Tektur nos títulos, Chakra Petch no texto) e ícones Material Symbols Sharp.

## Como rodar

```bash
npm install
npm start                    # http://localhost:4200
npm run build                # build de produção em dist/
npx ng test --watch=false    # testes das funções puras (utils/)
```

> Requer Node.js 20.19+ ou 22.12+.

## Estrutura

```
src/
├── index.html                 # fontes (Chakra Petch, Tektur, Material Symbols)
├── styles.scss                # tema Angular Material + estilos globais
├── styles/tailwind.css        # Tailwind + design tokens (cores, fontes, animações)
└── app/
    ├── app.config.ts          # providers globais
    ├── app.routes.ts          # rotas lazy (Shell + mesa em tela cheia)
    ├── core/                  # regras e dados, sem UI
    │   ├── config/            # app-settings (ex.: exigir conta ou não)
    │   ├── models/            # interfaces (User, GameTable, TableState, WorldItem, Point…)
    │   ├── services/          # auth, mesas, notícias, layout, storage (IndexedDB)
    │   └── utils/
    ├── shared/                # peças reutilizáveis
    │   ├── components/        # floating-window (janela arrastável), empty-state, color-picker,
    │   │                      # tag-editor (etiquetas), rich-text-editor (Tiptap)
    │   ├── directives/        # auto-focus
    │   ├── services/          # quick-actions, window-manager (janelas)
    │   └── utils/             # viewport (pan/zoom puro)
    ├── layout/
    │   ├── shell/             # barra lateral + área de conteúdo
    │   └── sidebar/           # navegação, Lore geral, conta
    └── features/
        ├── home/              # landing: banner, atalhos, notícias
        ├── auth/              # diálogo de login / cadastro
        ├── tables/            # "Minhas mesas" + diálogo de criação
        ├── game-table/        # a mesa de jogo (rota /mesa/:id, tela cheia)
        │   ├── components/    # map-stage (orquestrador), map-layers/ (desenhos, notas, névoa,
        │   │                  # tokens, paredes), barras, submenus, ficha de personagem (abas),
        │   │                  # janelas de NPC e token, mixer
        │   ├── services/      # table-session (estado + vínculo de tokens), sound-mixer, blob-url
        │   └── utils/         # geometria, visão (ray casting), simplificação de traços
        └── worldbuild/        # explorador de pastas + janelas flutuantes (também é a página /lore)
            ├── components/    # explorer, document-editor, timeline-editor, image-viewer, item-card
            ├── directives/    # lore-scope (editores usando a Lore geral)
            ├── services/      # worldbuild (dados + migração), lore (Lore geral, dados globais)
            └── utils/         # layout da linha do tempo em mapa mental
```

## Modo de teste (sem conta)

Em `src/app/core/config/app-settings.ts`, `requireAuth: false` faz o app usar
automaticamente um usuário "Visitante". Mude para `true` para voltar a exigir conta.

## Mesa de jogo

O mapa ocupa a tela inteira e as barras flutuam por cima — todas escondíveis:

- **Topo — cenas:** pastas e abas de mapas; adicionar (com imagem ou só grade), renomear, trocar mapa, ajustar grade,
  mover para pasta; botão de **vista isométrica** (mestre).
- **Esquerda — ferramentas:** selecionar (V), mover (M), régua em quadrados e metros (R), ping (P),
  desenhar (D), névoa de guerra (F) com paredes (W), anotação (N), efeitos especiais (E), grade (G), zoom.
- **Direita — painel:** Chat (mensagens e rolagens), Fichas (personagens e NPCs — arraste para o mapa; a imagem enviada na ficha é a do
  token; personagens abrem a ficha completa), Lore (itens da Lore geral e do worldbuild, com pastas próprias da mesa; renomear e remover valem
  só para a mesa), Sons (mixer), Ações (automações por personagem, NPC ou gerais do mestre).
- **Baixo — ações:** 10 espaços (teclas 1–0) com as ações de quem está agindo: o jogador vê as do personagem
  dele; o mestre, as do token selecionado (NPC ou personagem) ou as gerais.
- **Janelas:** todo arquivo abre numa janela que pode ser movida, redimensionada, minimizada, maximizada e fixada.
- **Modo imersivo:** tecla `\` esconde/mostra todas as barras.

### Ficha de personagem
Clicar num personagem no painel abre a ficha, com quatro abas:
- **Ficha:** cards de tamanhos diferentes — **Básico** (imagem, nome, raça, sub-raça e rótulos), **Status**
  (barras Corpo, Mente e Espírito e as etiquetas do personagem, que também aparecem no token), **Relações**
  (personagens com nível de 1 a 6 e descrição) e três **Temas** (nome, tags com nível de 1 a 6 e **Defeitos**
  com nível de -1 a -6).
- **Inventário:** lista dos itens do personagem e, ao lado, o cartão do item selecionado (imagem, nome e etiquetas).
  Editar o cartão aqui vale só para aquele personagem (o item do Worldbuild não muda).
- **Anotações:** caderno de texto rico com páginas.
- **Habilidades:** as ações do personagem, criadas por ele ou pelo mestre, com botão para usar. Cada ação pode
  usar tags e defeitos dos temas: o nível atual delas entra no modificador e acompanha a ficha automaticamente.

### Ficha de NPC e lojas
A ficha de NPC é igual à de personagem, sem Anotações e sem Relações. NPCs são do mestre, que pode:
- dar o **controle** de um NPC a um jogador específico (ele passa a ver, editar e usar o NPC);
- deixar a **ficha** e/ou o **inventário** do NPC visíveis para os jogadores (só leitura);
- pôr **preços em Eiros** nos itens do inventário do NPC, criando uma loja. Com o inventário visível, o jogador
  seleciona um item e compra com os Eiros do personagem dele (campo no topo da aba Inventário da ficha); uma unidade
  do item vai para o inventário do personagem e a quantidade da loja baixa 1.
- Se alguma barra de status do NPC chegar a 0, o token dele ganha um **X vermelho** e os jogadores com acesso ao
  inventário podem **lootear** os itens, sem pagar.

Itens de inventário têm **quantidade**, e cada personagem pode **dar** um item a outro ("Dar para…" no cartão),
com as etiquetas e mudanças que fez nele.

### Tokens
Arraste a ficha de um personagem ou NPC do painel para o mapa para colocar o token. Ele tem imagem
circular, tamanho, visão, barras (ex.: PV 12/20) e etiquetas com cor e nível (ex.: Exaustão 2), tudo
configurado com **duplo clique no token**. Tokens de **personagem** são vinculados à ficha; cada token de
**NPC** é independente (cinco goblins, cinco PVs). Arraste para mover (snap à grade; Shift ou grade
escondida = livre), use **WASD/setas** para deslizar devagar, a alça para redimensionar e Delete para remover.

A velocidade do movimento com WASD/setas é configurada por ficha, na janela do token.

### Vista isométrica e camadas do mapa
O mestre pode ver a cena como uma mesa vista de lado (isométrica): o mapa se inclina e os tokens ficam de pé.
Nessa vista, o painel **Camadas** (barra de ferramentas) cria até 5 camadas empilhadas — térreo, telhados, céu… —
cada uma com sua imagem. Camada sem imagem é "ar": mostra a de baixo, e os tokens nela parecem voar, com sombra
no chão. O mestre escolhe a camada que os jogadores veem; trocar de camada desliza a pilha como um elevador.
PageUp/PageDown sobem e descem o token selecionado.

### Ações, rolagens e chat
Cada ação rola **2d12** ou **3d6** + modificador. 2d12: abaixo de 0 falha crítica, até 11 falha, até 16
sucesso parcial, até 23 sucesso, 24+ sucesso crítico. 3d6: até 9 azar, 10–12 neutro, 13+ sorte. O resultado
vai para o **chat** da mesa, que também recebe mensagens digitadas.

### Efeitos especiais
Ferramenta **E**: arraste no mapa para lançar um dos 20 efeitos, na cor do elemento (fogo, gelo, água,
eletricidade, sombra…):
- **Golpes:** corte, garras, estocada, impacto
- **Disparos:** flecha, orbe, bola de fogo, raio, feixe, jato
- **Área:** explosão, onda de choque, fumaça, chuva de meteoros, erupção de estacas, vórtice
- **Magia:** cura, escudo, círculo de runas, teleporte

Uma ação pode ter efeito: ao usá-la, ele fica no mouse até você arrastar.

### Névoa de guerra
Paredes em linha ou círculo e **portas** (abrem e fecham com um clique) bloqueiam a visão dos tokens.
Paredes podem ser movidas e editadas ponto a ponto. Na visão de **Jogador** a névoa é opaca e só se abre
onde os tokens enxergam — e as áreas já exploradas continuam reveladas, escurecidas (memória da névoa).
Na de **Mestre** fica semitransparente, com o contorno das áreas visíveis.

### Desenho e anotações
Pincel com cores, espessuras, opacidade, borracha e Ctrl+Z. Anotações são marcadores no mapa com título,
texto, cor e opção "só o mestre vê".

### Sons
Várias faixas tocando juntas, cada uma com volume e repetição, mais volume mestre e "Parar tudo".

## Worldbuild e Lore geral

O **Worldbuild** é de cada usuário. A **Lore geral** (`/lore`, na barra lateral) é a lore oficial do mundo,
igual para todos — mesma página e mesmos editores, com dados globais.

- **Explorador** (escondível): pastas livres, arrastar para mover, renomear com duplo clique, busca.
- **Janelas flutuantes**: cada item abre numa janela que pode ser movida, redimensionada e maximizada (duplo clique na barra).
- **Documentos**: editor rico (títulos, listas, citações, alinhamento), salvamento automático.
- **Linhas do tempo em mapa mental**: cartões livres ligados por setas (ramificações e eventos paralelos),
  criação de eventos conectados pelas alças, rótulos nas setas e organização automática.
- **Mapas e imagens**: envio por botão ou arrastando arquivos; zoom com a roda do mouse e navegação arrastando.
- **Itens**: aba própria no explorador para criar e listar os itens do mundo; cada item tem um cartão com
  imagem, nome e etiquetas e pode ir para o inventário dos personagens. Também acessível dentro da mesa.

## Dados (provisório)

Ainda não há backend. Contas, mesas e worldbuild ficam no **IndexedDB do navegador**
(`core/services/storage.service.ts`). Para conectar uma API, basta trocar a
implementação desse serviço e do `AuthService` — a interface usada pelas telas
continua a mesma.
