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

Arquitetura detalhada (camadas, fluxos de dados e onde fica o estado) em [`ARCHITECTURE.md`](ARCHITECTURE.md).

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
    │   └── sidebar/           # navegação, mundos, mesas, conta
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
        └── worldbuild/        # explorador de pastas (com seletor de mundo) + janelas flutuantes
            ├── components/    # explorer, document-editor, timeline-editor, image-viewer, item-card, race-card
            ├── directives/    # world-npc-sheet (ficha base dos NPCs do bestiário)
            ├── services/      # worldbuild (itens do mundo aberto + migrações), world-npc store
            └── utils/         # layout da linha do tempo em mapa mental, referências dos eventos
```

## Modo de teste (sem conta)

Em `src/app/core/config/app-settings.ts`, `requireAuth: false` faz o app usar
automaticamente um usuário "Visitante". Mude para `true` para voltar a exigir conta.

## Mesa de jogo

O mapa ocupa a tela inteira e as barras flutuam por cima — todas escondíveis:

- **Topo — cenas:** pastas e abas de mapas; adicionar (com imagem ou só grade), renomear, trocar mapa, ajustar grade,
  mover para pasta; botão de **vista isométrica** (mestre).
- **Esquerda — ferramentas:** selecionar (V), mover (M), régua em quadrados e metros (R), ping (P),
  desenhar (D), névoa de guerra (F, só mestre) com paredes (W), anotação (N), efeitos especiais (E), zoom. A grade
  é ligada e desligada nas opções da cena.
- **Direita — painel:** Chat (mensagens e rolagens), Fichas (personagens e NPCs — arraste para o mapa; a imagem enviada na ficha é a do
  token; personagens abrem a ficha completa), Lore (a árvore do mundo da mesa: o que o mestre muda ali muda o mundo;
  cada pasta tem um olho, valendo só para aquela mesa: os jogadores só leem as pastas que o mestre revelar), Sons (mixer), Ações (automações por personagem, NPC ou gerais do mestre).
- **Baixo — ações:** 10 espaços (teclas 1–0) com as ações de quem está agindo: o jogador vê as do personagem
  dele; o mestre escolhe no menu "Agindo" um personagem ou NPC fixo, as ações gerais ou seguir o token selecionado.
  À direita, o botão **Rolar** faz a rolagem básica (2d12 ou 3d6 + modificador na hora), somando se quiser as tags e
  defeitos dos temas e as etiquetas dos itens equipados e de status (como bônus ou penalidade) de quem
  está agindo — nada fica salvo. Ações automatizadas também podem usar as etiquetas dos itens equipados, como bônus ou
  penalidade; se o item for desequipado, a etiqueta sai da ação. No chat, cada rolagem mostra o resultado em destaque,
  os dados e o total e, separados, o modificador do personagem e o dos itens.
- **Janelas:** todo arquivo abre numa janela que pode ser movida, redimensionada, minimizada (vira uma barra
  estreita), maximizada e fixada.
- **Visão de Jogador:** sem a ferramenta Névoa, sem as cenas da barra superior e sem as abas Sons e Ações; move
  tokens de personagens, mas de NPCs só os que o mestre liberou, e cria ações na aba Habilidades da ficha.
- **Modo imersivo:** tecla `\` esconde/mostra todas as barras; no modo imersivo, o botão "Sair do modo imersivo"
  (canto superior direito) reabre todas de uma vez.

### Ficha de personagem
Clicar num personagem no painel abre a ficha, com quatro abas:
- **Ficha:** cards de tamanhos diferentes — **Básico** (imagem, nome, raça, sub-raça e rótulos), **Status**
  (barras Corpo, Mente e Espírito, começando em 24, e as etiquetas do personagem, que também aparecem no token), **Relações**
  (personagens com nível de 1 a 6 e descrição) e três **Temas** (nome, tags com nível de 1 a 6, **Defeitos**
  com nível de -1 a -6 e um **Objetivo** com 5 marcadores de avanço) e, abaixo deles, os itens **Equipados** (clique
  abre o cartão do item numa janela) e os **Estudos e Treinos**: três etiquetas com SA (Sucessos Acumulados) e SN
  (Sucessos Necessários, definido pelo mestre). Ligado a uma rolagem, sem modificador, o estudo ganha 1 SA com 12+ e 2
  com sucesso crítico; ao alcançar o SN, mestre e jogador são avisados de que ele subiu de nível.
- **Inventário:** lista dos itens do personagem e, ao lado, o cartão do item selecionado (imagem, nome, descrição e etiquetas).
  Editar o cartão aqui vale só para aquele personagem (o item do Worldbuild não muda). A caixa à esquerda de cada
  item marca se ele está **equipado**. Itens que um jogador cria no inventário ficam só naquela mesa (não vão para o
  Worldbuild) e aparecem na aba **Lore** da mesa, visíveis a todos os jogadores.
- **Anotações:** caderno de texto rico com páginas. **Background** e **Jornal** são fixas (sempre as primeiras);
  as demais podem ser criadas, excluídas e arrastadas para reorganizar.
- **Habilidades:** as ações do personagem, criadas por ele ou pelo mestre, com botão para usar. Cada ação pode
  usar tags e defeitos dos temas: o nível atual delas entra no modificador e acompanha a ficha automaticamente.

### Ficha de NPC, bestiário e lojas
A ficha de NPC é igual à de personagem (inclusive os itens **equipados**), sem Anotações e sem Relações. As fichas base ficam no **bestiário**
(aba "NPCs" do Worldbuild); o NPC no painel da mesa é só uma referência a ela. As **habilidades** também ficam no
NPC do bestiário e valem em todas as mesas do mundo. Cada **token** de NPC colocado no
mapa é uma cópia individual — duplo clique abre a ficha daquele token, com status, etiquetas, temas e inventário
próprios, sem mexer no NPC do painel nem no bestiário. NPCs são do mestre, que pode:
- dar o **controle** de um NPC a um jogador específico (ele passa a ver, editar e usar o NPC);
- deixar a **ficha** e/ou o **inventário** de cada **token** de NPC visíveis para os jogadores (só leitura) — um
  token derrotado mostra o inventário sozinho;
- pôr **preços em Eiros** nos itens do inventário do NPC, criando uma loja. Com o inventário visível, o jogador
  seleciona um item e compra com os Eiros do personagem dele (campo no topo da aba Inventário da ficha); uma unidade
  do item vai para o inventário do personagem e a quantidade da loja baixa 1.
- Se alguma barra de status do NPC chegar a 0, o token dele ganha um **X vermelho** e os jogadores com acesso ao
  inventário podem **lootear** os itens, sem pagar.

Itens de inventário têm **quantidade**, e cada personagem pode **dar** um item a outro ("Dar para…" no cartão),
com as etiquetas e mudanças que fez nele.

### Tokens
Arraste a ficha de um personagem ou NPC do painel para o mapa para colocar o token. Ele tem imagem
circular, tamanho (de meio quadrado até 6, para criaturas enormes), visão, barras (ex.: PV 12/20) e etiquetas com cor e nível (ex.: Exaustão 2), tudo
configurado com **duplo clique no token**. Tokens de **personagem** são vinculados à ficha; cada token de
**NPC** é independente (cinco goblins, cinco PVs). Arraste para mover (snap à grade; Shift ou grade
escondida = livre), use **WASD/setas** para deslizar devagar, a alça para redimensionar e Delete para remover.

A velocidade do movimento com WASD/setas é configurada por ficha, na janela do token.

### Vista isométrica e camadas do mapa
O mestre pode ver a cena como uma mesa vista de lado (isométrica): o mapa se inclina e os tokens ficam de pé.
Nessa vista, o painel **Camadas** (barra de ferramentas) cria até 5 camadas empilhadas — térreo, telhados, céu… —
cada uma com sua imagem. Camada sem imagem é "ar": mostra a de baixo, e os tokens nela parecem voar, com sombra
no chão. O mestre escolhe a camada que os jogadores veem; trocar de camada desliza a pilha como um elevador.
PageUp/PageDown sobem e descem o token selecionado. Paredes e portas são de cada camada: são desenhadas na camada
em foco e só bloqueiam a visão nela.

### Ações, rolagens e chat
Cada ação rola **2d12** ou **3d6** + modificador. 2d12: abaixo de 0 falha crítica, até 11 falha, 12 a 17
sucesso parcial, 18 a 23 sucesso, 24+ sucesso crítico. 3d6: até 9 azar, 10–12 neutro, 13+ sorte. O resultado
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

### Itens no mapa
Itens podem ser **largados no chão**: o mestre arrasta um item da aba Lore (ou de "Itens da mesa") até o mapa, e
quem edita uma ficha arrasta um item do inventário (larga uma unidade, com a personalização). No mapa, o item é um
losango com a imagem e a quantidade. Um clique seleciona o item; o duplo clique abre o cartão completo e a lista de
quem pode **pegá-lo** — personagens e tokens de NPC, quem age primeiro e depois os mais próximos. A pilha inteira vai
para o inventário. O mestre move, redimensiona pela alça, escolhe a cor da borda, muda a quantidade e tira itens do
mapa (Delete no item selecionado). Com névoa, o jogador só vê os itens que algum token enxerga.

### Sons
Várias faixas tocando juntas, cada uma com volume e repetição, mais volume mestre e "Parar tudo".

## Mundos e Worldbuild

Cada usuário tem até **2 mundos**, e cada mundo é um **Worldbuild** separado (escolha e crie no cabeçalho do
explorador ou pela barra lateral). Cada mesa se passa num mundo, escolhido ao criá-la, e a aba Lore dela mostra os
itens desse mundo.

- **Explorador** (escondível): pastas livres, arrastar para mover, renomear com duplo clique, busca.
- **Janelas flutuantes**: cada item abre numa janela que pode ser movida, redimensionada e maximizada (duplo clique na barra).
- **Documentos**: editor rico (títulos, listas, citações, alinhamento), salvamento automático.
- **Linhas do tempo em mapa mental**: cartões livres ligados por setas (ramificações e eventos paralelos),
  criação de eventos conectados pelas alças, rótulos nas setas e organização automática.
- **Mapas e imagens**: envio por botão ou arrastando arquivos; zoom com a roda do mouse e navegação arrastando.
- **NPCs (bestiário)**: aba própria no explorador com as fichas base dos NPCs, usadas pelas mesas.
- **Itens**: aba própria no explorador para criar e listar os itens do mundo; cada item tem um cartão com
  imagem, nome e etiquetas e pode ir para o inventário dos personagens. Também acessível dentro da mesa.
- **Raças**: características, imagens padrão e modificadores de status; escolhidas na ficha (raça e sub-raça).

## Dados (provisório)

Ainda não há backend. Contas, mesas e worldbuild ficam no **IndexedDB do navegador**
(`core/services/storage.service.ts`). Para conectar uma API, basta trocar a
implementação desse serviço e do `AuthService` — a interface usada pelas telas
continua a mesma.
