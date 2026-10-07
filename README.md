# DiceTag

Mesa virtual (VTT) para jogar RPG de mesa online com amigos.
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
    │   ├── components/        # floating-window (janela arrastável), empty-state
    │   ├── directives/        # auto-focus
    │   ├── services/          # quick-actions, window-manager (janelas)
    │   └── utils/             # viewport (pan/zoom puro)
    ├── layout/
    │   ├── shell/             # barra lateral + área de conteúdo
    │   └── sidebar/           # navegação, criação rápida, conta
    └── features/
        ├── home/              # landing: banner, atalhos, notícias
        ├── auth/              # diálogo de login / cadastro
        ├── tables/            # "Minhas mesas" + diálogo de criação
        ├── game-table/        # a mesa de jogo (rota /mesa/:id, tela cheia)
        │   ├── components/    # map-stage (orquestrador), map-layers/ (desenhos, notas, névoa,
        │   │                  # tokens, paredes), barras, submenus, janelas de ficha e token, mixer
        │   ├── services/      # table-session (estado + vínculo de tokens), sound-mixer, blob-url
        │   └── utils/         # geometria, visão (ray casting), simplificação de traços
        └── worldbuild/        # explorador de pastas + janelas flutuantes
            ├── components/    # explorer, document-editor, timeline-editor, image-viewer
            ├── services/      # worldbuild (dados + migração)
            └── utils/         # layout da linha do tempo em mapa mental
```

## Modo de teste (sem conta)

Em `src/app/core/config/app-settings.ts`, `requireAuth: false` faz o app usar
automaticamente um usuário "Visitante". Mude para `true` para voltar a exigir conta.

## Mesa de jogo

O mapa ocupa a tela inteira e as barras flutuam por cima — todas escondíveis:

- **Topo — cenas:** abas de mapas; adicionar (com imagem ou só grade), renomear, trocar mapa, ajustar grade.
- **Esquerda — ferramentas:** selecionar (V), mover (M), régua em quadrados e metros (R), ping (P),
  desenhar (D), névoa de guerra (F) com paredes (W), anotação (N), grade (G), zoom.
- **Direita — painel:** Fichas (personagens e NPCs — arraste para o mapa), Lore (itens do worldbuild e as
  pastas do Worldbuild numa janela, sem sair da mesa), Sons (mixer), Automações.
- **Baixo — ações:** 10 espaços (teclas 1–0) com as automações do papel atual (Mestre/Jogador).
- **Janelas:** todo arquivo abre numa janela que pode ser movida, redimensionada, minimizada, maximizada e fixada.
- **Modo imersivo:** tecla `\` esconde/mostra todas as barras.

### Tokens
Arraste a ficha de um personagem ou NPC do painel para o mapa para colocar o token. Ele tem imagem
circular, tamanho, visão, barras (ex.: PV 12/20) e etiquetas com cor e nível (ex.: Exaustão 2), tudo
configurado com **duplo clique no token**. Tokens de **personagem** são vinculados à ficha; cada token de
**NPC** é independente (cinco goblins, cinco PVs). Arraste para mover (snap à grade; Shift ou grade
escondida = livre), use **WASD/setas** para deslizar devagar, a alça para redimensionar e Delete para remover.

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

## Worldbuild

- **Explorador** (escondível): pastas livres, arrastar para mover, renomear com duplo clique, busca.
- **Janelas flutuantes**: cada item abre numa janela que pode ser movida, redimensionada e maximizada (duplo clique na barra).
- **Documentos**: editor rico (títulos, listas, citações, alinhamento), salvamento automático.
- **Linhas do tempo em mapa mental**: cartões livres ligados por setas (ramificações e eventos paralelos),
  criação de eventos conectados pelas alças, rótulos nas setas e organização automática.
- **Mapas e imagens**: envio por botão ou arrastando arquivos; zoom com a roda do mouse e navegação arrastando.

## Dados (provisório)

Ainda não há backend. Contas, mesas e worldbuild ficam no **IndexedDB do navegador**
(`core/services/storage.service.ts`). Para conectar uma API, basta trocar a
implementação desse serviço e do `AuthService` — a interface usada pelas telas
continua a mesma.
