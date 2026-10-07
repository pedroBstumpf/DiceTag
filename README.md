# DiceTag

Mesa virtual (VTT) para jogar RPG de mesa online com amigos.
Angular 21 · Angular Material (M3) · Tailwind CSS 4 · Tiptap (editor de texto).

Visual: tema espacial (preto, azul e branco), fontes angulares inspiradas em runas
(Tektur nos títulos, Chakra Petch no texto) e ícones Material Symbols Sharp.

## Como rodar

```bash
npm install
npm start          # http://localhost:4200
npm run build      # build de produção em dist/
```

> Requer Node.js 20.19+ ou 22.12+.

## Estrutura

```
src/
├── index.html                 # fontes (Chakra Petch, Tektur, Material Symbols)
├── styles.scss                # tema Angular Material + estilos globais
├── styles/tailwind.css        # Tailwind + design tokens (cores, fontes)
└── app/
    ├── app.config.ts          # providers globais
    ├── app.routes.ts          # rotas lazy (Shell + mesa em tela cheia)
    ├── core/                  # regras e dados, sem UI
    │   ├── config/            # app-settings (ex.: exigir conta ou não)
    │   ├── models/            # interfaces (User, GameTable, TableState, WorldItem, NewsPost)
    │   ├── services/          # auth, mesas, notícias, layout, storage (IndexedDB)
    │   └── utils/
    ├── shared/                # peças reutilizáveis
    │   ├── components/        # floating-window (janela arrastável), empty-state
    │   ├── directives/        # auto-focus
    │   └── services/          # quick-actions, window-manager (janelas)
    ├── layout/
    │   ├── shell/             # barra lateral + área de conteúdo
    │   └── sidebar/           # navegação, criação rápida, conta
    └── features/
        ├── home/              # landing: banner, atalhos, notícias
        ├── auth/              # diálogo de login / cadastro
        ├── tables/            # "Minhas mesas" + diálogo de criação
        ├── game-table/        # a mesa de jogo (rota /mesa/:id, tela cheia)
        │   ├── components/    # map-stage, scene-bar, tool-bar, side-panel, action-bar,
        │   │                  # entry-window, sound-player
        │   └── services/      # table-session (cenas, arquivos, ferramenta, papel)
        └── worldbuild/        # explorador de pastas + janelas flutuantes
            ├── components/    # explorer, document-editor, timeline-editor, image-viewer
            └── services/      # worldbuild (dados)
```

## Modo de teste (sem conta)

Em `src/app/core/config/app-settings.ts`, `requireAuth: false` faz o app usar
automaticamente um usuário "Visitante". Mude para `true` para voltar a exigir conta.

## Mesa de jogo

O mapa ocupa a tela inteira e as barras flutuam por cima — todas escondíveis:

- **Topo — cenas:** abas de mapas; adicionar (com imagem ou só grade), renomear, trocar mapa, ajustar grade.
- **Esquerda — ferramentas:** selecionar/mover (V, M), régua em quadrados e metros (R), ping (P), grade (G), zoom.
- **Direita — painel:** Fichas (personagens e NPCs), Lore (itens do worldbuild), Sons (envio e reprodução), Automações.
- **Baixo — ações:** 10 espaços (teclas 1–0) com as automações do papel atual (Mestre/Jogador).
- **Janelas:** todo arquivo abre numa janela que pode ser movida, redimensionada, minimizada, maximizada e fixada.
- **Modo imersivo:** tecla `\` esconde/mostra todas as barras.

## Dados (provisório)

Ainda não há backend. Contas, mesas e worldbuild ficam no **IndexedDB do navegador**
(`core/services/storage.service.ts`). Para conectar uma API, basta trocar a
implementação desse serviço e do `AuthService` — a interface usada pelas telas
continua a mesma.

## Worldbuild

- **Explorador** (escondível): pastas livres, arrastar para mover, renomear com duplo clique, busca.
- **Janelas flutuantes**: cada item abre numa janela que pode ser movida, redimensionada e maximizada (duplo clique na barra).
- **Documentos**: editor rico (títulos, listas, citações, alinhamento), salvamento automático.
- **Linhas do tempo**: eventos com data livre, descrição e cor; reordenação por arraste.
- **Mapas e imagens**: envio por botão ou arrastando arquivos; zoom com a roda do mouse e navegação arrastando.
