# SPEC — Preparação para o back-end e o multiplayer

Decisões de arquitetura e pendências que **precisam ser resolvidas antes ou durante a fase de back-end**.
Cada item diz o que é, por que importa, o que já foi preparado e **quando** fazer.
Complementa o [`ARCHITECTURE.md`](ARCHITECTURE.md) (como o app é hoje) e o [`CLAUDE.md`](CLAUDE.md) (regras de negócio).

---

## 0. Já feito (base para o que vem abaixo)

| O quê | Onde | Para que serve no back-end |
|---|---|---|
| Toda mutação da mesa é um **comando puro** `(estado, payload) → novo estado`, com payload serializável | `features/game-table/state/*.ts`, catálogo em `state/commands.ts` | É o que o cliente envia e o servidor aplica (a mesma função dos dois lados) |
| Ponto único de alteração: `TableSessionService.dispatch(type, payload)` | `table-session.service.ts` | É ali que o comando passa a ir para a rede |
| **Regras de permissão puras** (`canEdit`, `sheetAccess`, `canSeeLoreItem`, `canEditTableItem`…) com quem olha (`Viewer`) como parâmetro | `state/permissions.ts` | O servidor valida cada comando com as mesmas regras |
| **O que o jogador vê** sob a névoa (tokens, anotações, portas) | `state/player-view.ts` | Base do filtro do estado enviado a cada jogador |
| Rolagem com sorteio injetável (`rollDice(config, random, levels)`) | `utils/dice.ts` | O servidor rola com o próprio gerador |
| `navigator.storage.persist()` ao criar dados | `StorageService.requestPersistence` | Reduz o risco de perder dados enquanto tudo é local |
| **Servidor** (HTTP + WebSocket, SQLite) com contas e sessões reais, mesas, membros, convites, mundos e arquivos | `server/` ([guia](server/README.md)) | Base dos repositórios do §2 (falta o front usá-lo) |
| Sala da mesa com snapshot + versão, comandos validados (formato e permissão) e aplicados com `applyCommand` | `server/src/realtime/` | §1 itens 1–3 e 5; falta a reconciliação no cliente (item 4) |
| Projeção por jogador (cena aberta, sem notas secretas, fichas de NPC liberadas, sem ações do mestre) com **visão calculada no servidor**: com névoa, só tokens, anotações, itens, efeitos e portas à vista, sem as paredes; os polígonos vão no campo `vision` | `realtime/projection.ts`, `realtime/vision.ts` | §3.1; a memória da névoa também é marcada pelo servidor (`Room.explore`) |
| Ficha validada no servidor (esquema estrito com os limites das regras; raça aplicada pelo servidor; máximo das barras só do mestre; itens revelados) e gravada por campo (`patchSheet`) | `realtime/sheet-rules.ts`, `state/sheets.ts` | §1 "ficha gravada inteira": feito |
| Comandos com o valor final (portas, liberações de token, Lore) e desfazer como comando inverso | `state/fog.ts`, `state/tokens.ts`, `state/lore.ts`, `state/undo.ts` | §1 e §4: feito |
| Rolagem no servidor (`crypto.randomInt`, níveis da ficha atual, gasto de Espírito) | `realtime/rolls.ts` | §3.2 |
| Papel vindo da conta (dono = mestre, convite = jogador) e permissões por comando | `realtime/command-rules.ts` | §3.3 |
| **Mesa online no front**: conta do servidor, mesas e convites (`core/services/server-*.ts`, `online-tables.service.ts`) e a mesa de jogo ligada à sala (`TableRoom`), com reconciliação no cliente | `features/game-table/state/sync.ts`, `services/table-room.ts` | §1 item 4 (feito); arquivos e Worldbuild da mesa online no servidor; eventos efêmeros (ping, efeitos) e sons em tempo real |
| Itens que mudam de lugar em um comando só, com preço e estoque conferidos no servidor | `state/inventory.ts`, `realtime/command-rules.ts` | §1 "transferItem…": feito |
| Rolagem no servidor com itens equipados, estudos e NPC do bestiário | `realtime/rolls.ts` | §3.2: feito |

---

> **Decisão de produto (v0.4.0):** o app é só por convite e roda no computador do dono (`npm run mesa` + Tailscale Funnel). Ver `server/OPERATIONS.md` §1.

## 1. Sincronização em tempo real e conflitos

### Problema
Hoje o `TableState` inteiro (cenas, tokens, fichas, chat de até 300 mensagens, máscara da névoa em
base64) é regravado a cada alteração. No multiplayer, mandar a mesa inteira pela rede porque alguém
moveu um token não escala. Também é preciso decidir o que acontece quando duas pessoas mexem na mesma
coisa ao mesmo tempo.

### Decisão: servidor autoritativo com comandos ordenados

1. **Cada mesa é uma sala** no servidor (WebSocket), com um **log de comandos ordenado** e um
   número de versão que só cresce.
2. O cliente **aplica o comando na hora** (resposta imediata na tela) e o envia como
   `{ type, payload, clientSeq }`.
3. O servidor **valida** o comando (permissões, §3), **aplica a mesma função** de `state/`, grava,
   dá a ele a próxima versão e o **repassa** aos outros clientes da sala.
4. **Reconciliação no cliente:** ele guarda os comandos ainda não confirmados. Ao receber um comando
   de outra pessoa, volta ao último estado confirmado, aplica o comando recebido e reaplica os seus
   pendentes. Comando recusado é descartado, e a tela volta ao estado do servidor.
5. **Entrada na mesa:** o cliente baixa um *snapshot* (estado + versão) e passa a receber os comandos
   seguintes. Periodicamente, o servidor grava um snapshot novo, para não reaplicar o log desde o começo.

**Conflitos:** a ordem do servidor decide, e o último comando a chegar vence, campo a campo. Isso basta
para um VTT porque os comandos são **finos e com valores absolutos** (`moveToken` leva a posição final,
não um deslocamento). Se dois jogadores arrastam o mesmo token, ganha o último, e todos veem o mesmo resultado.

Não usar CRDT no estado da mesa: é complexo demais para o ganho. A exceção é o texto rico (ver abaixo).

### Ajustes necessários nos comandos (fazer no início da fase de back-end)

| Hoje | Problema com duas pessoas | Mudança |
|---|---|---|
| ~~`toggleDoor`, `toggleTokenPublic`, `toggleLoreReveal`~~ | ~~Dois cliques ao mesmo tempo se anulam~~ | **Feito (v0.7):** `setDoorOpen { open }`, `setTokenPublic { part, value }`, `setLoreReveal { folderId, revealed }`; o mesmo valor de novo não muda nada |
| ~~Ficha gravada inteira~~ | ~~Um apaga a alteração do outro~~ | **Feito (v0.7):** `patchSheet { sheetId, patch }` leva só os campos alterados (`null` apaga um campo) e quem aplica junta com a ficha atual. Cada campo ainda vai inteiro (duas pessoas no mesmo inventário: vale a última lista); comandos por item (`addInventoryItem`, `setTagLevel`…) só se isso virar problema |
| ~~`transferItem`, `buyItem`, `lootItem` (várias gravações no cliente)~~ | ~~Dois jogadores comprando a última unidade duplicam o item~~ | **Feito:** um comando só, executado no servidor, que confere estoque e Eiros (`state/inventory.ts`) |
| `updateScene { patch }` genérico | O servidor não sabe o que está sendo alterado (permissão) | **Decidido manter (v0.7):** ele já é só do mestre e o esquema confere cada campo (`strictObject`). Comandos específicos só quando um campo da cena passar a ser do jogador |
| ~~Memória da névoa (`setExplored`) gravada pelo cliente~~ | ~~Só marcava com o mestre na cena e com a aba dele aberta~~ | **Feito (v0.7):** a sala marca (`Room.explore`, `nextExplored`) com a visão dos jogadores na camada deles; o mestre informa o tamanho do mapa (`Scene.mapSize`, `setMapSize`). Uma máscara só, do grupo |

### O que não vira comando
Pings, efeitos especiais, cursor e token **durante o arraste** são **eventos efêmeros**: são
repassados, mas não entram no log nem são gravados. O token envia `moveToken` ao soltar e, durante
o arraste, só pré-visualizações.

### Texto rico (documentos, anotações da ficha)
- **Primeira versão:** o último a gravar vence, por documento, com um aviso "Fulano está editando".
- **Se houver edição simultânea de verdade:** Yjs + `y-prosemirror`, que o Tiptap já suporta. É a
  única parte que justifica CRDT.

### Quando
**No início da fase de back-end**, junto com o protocolo da sala. A preparação que dava para fazer
sem servidor (comandos puros e ponto único de `dispatch`) já está feita. Fazer o resto antes seria
desenhar o protocolo às cegas.

---

## 2. Repositórios por domínio (no lugar do `StorageService` chave/valor)

### Problema
O `StorageService` (`get`/`set`/`delete` de chaves como `worldbuild:<userId>`) **não** é a interface que
uma API real teria. Uma API trabalha com operações de domínio ("listar mesas", "salvar ficha").
O mesmo vale para o `AuthService`: autenticação real usa tokens de acesso, expiração e renovação, e não
contas guardadas no IndexedDB.

### Decisão
Interfaces de repositório por domínio, fornecidas por injeção de dependência, como já é feito com o
`SheetStore`. Na fase de back-end, escreve-se a implementação HTTP/WebSocket e troca-se só o provedor.

```ts
abstract class TablesRepository {        // "Minhas mesas"
  abstract list(): Promise<GameTable[]>;
  abstract create(data: NewGameTable): Promise<GameTable>;
  abstract remove(id: string): Promise<void>;   // o servidor apaga estado e arquivos
}

abstract class TableSessionRepository {  // a mesa aberta (ver §1)
  abstract open(tableId: string): Promise<{ state: TableState; version: number }>;
  abstract send(command: TableCommand): void;
  abstract onCommand(fn: (command: TableCommand, version: number) => void): () => void;
}

abstract class WorldRepository {         // mundos do usuário e o Worldbuild de cada um
  abstract worlds(): Promise<World[]>;
  abstract list(worldId: string): Promise<WorldItem[]>;
  abstract save(worldId: string, item: WorldItem): Promise<void>;
  abstract remove(worldId: string, ids: string[]): Promise<void>;
}

abstract class FilesRepository {         // mapas, imagens, áudios — feito como FileStore (core/services/file-store.ts)
  abstract upload(file: Blob): Promise<string>;      // devolve o id
  abstract url(id: string): Promise<string>;         // object URL hoje; URL assinada no servidor
  abstract remove(id: string): Promise<void>;
}

abstract class AuthGateway {             // sessão real: tokens, expiração, renovação
  abstract user: Signal<User | null>;
  abstract login(email: string, password: string): Promise<void>;
  abstract logout(): Promise<void>;
}
```

Hoje cada um teria uma implementação sobre o IndexedDB, que continua útil como **modo offline ou de
testes**.

### Por que não agora
- O formato do `TableSessionRepository` (snapshot, envio de comandos, assinatura) é **definido pelo
  protocolo do §1**. Criar agora um "carregar/salvar a mesa inteira" seria criar a interface errada.
- Com uma única implementação, a camada extra não traz ganho hoje.

### Quando
**Primeiro passo da fase de back-end**, junto com a escolha da API. Ordem sugerida: `FilesRepository`
(é o mais isolado: hoje as chaves `blob:` estão espalhadas em vários serviços), depois `AuthGateway`,
`TablesRepository`, `WorldRepository` e, por último, o `TableSessionRepository` junto com o §1.

---

## 3. O navegador do jogador não é confiável

Hoje permissões, visão e rolagens rodam no navegador. Localmente isso é aceitável. No multiplayer,
há três riscos clássicos de VTT.

### 3.1 Névoa, tokens escondidos e segredos do mestre
**Risco:** se o servidor enviar o estado completo, qualquer jogador abre as ferramentas do navegador e
vê os tokens escondidos, as notas do mestre, as fichas de NPC e a lore não revelada.

**Decisão:** o servidor monta, para cada jogador, uma **projeção** do estado com só o que ele pode ver:

| Dado | Regra (já pura no cliente) |
|---|---|
| Tokens fora da visão | `visibleTokensFor` (`state/player-view.ts`) |
| Anotações "só mestre" e fora da visão | `visibleNotesFor` |
| Portas não vistas | `visibleDoorsFor` |
| Fichas e inventários de NPC | `sheetAccess` (`state/permissions.ts`): só o que o mestre liberou naquele token |
| Itens da lore não revelados | `canSeeLoreItem` |
| Ações do mestre e de NPCs não controlados | não enviar |

- **Visão calculada no servidor:** os polígonos de visão (`computeVisibilityPolygon`) são calculados
  pelo servidor com as posições oficiais, e o jogador recebe os polígonos e as entidades visíveis, **não as
  paredes** (elas revelariam a planta do mapa).
- Quando um token se move, o servidor recalcula o que cada jogador vê e envia o que **entrou** ou
  **saiu** da visão dele.
- **Imagem do mapa:** o jogador recebe o mapa inteiro, e a névoa é desenhada por cima. Um jogador
  determinado consegue ver o mapa sem névoa. Decisão: **aceitar no começo**, como fazem os VTTs mais
  usados. Se virar problema, o servidor recorta o mapa por jogador, o que é caro.

### 3.2 Rolagens de dados
**Risco:** dado rolado no navegador pode ser manipulado.

**Decisão:** rolagens que importam (ações e "Rolar") são feitas **no servidor**:
1. o cliente envia a intenção (`useAction { actionId, sheetId }` ou `quickRoll { dice, modifier, tags }`), sem resultado;
2. o servidor recalcula o modificador com as tags **atuais** da ficha (não confia no número enviado),
   sorteia com gerador criptográfico (`rollDice(config, randomInt, levels)`), aplica Estudos e Treinos
   e grava a mensagem do chat;
3. todos recebem o resultado ao mesmo tempo.

As funções de `utils/dice.ts` já são puras e recebem o sorteio como parâmetro, então funcionam no servidor sem mudança.

### 3.3 Permissões
**Risco:** `sheetAccess` e `canEdit` hoje só escondem botões. Qualquer comando pode ser enviado "na mão".

**Decisão:**
- O servidor confere **cada comando** antes de aplicar, com as funções de `state/permissions.ts` e uma
  tabela "comando → regra" (ex.: `moveToken` exige `canEdit` da ficha do token; `setFog` exige mestre).
- O **papel** deixa de ser escolhido na mesa: vem da conta e do convite (dono da mesa = mestre). O botão
  Mestre/Jogador da barra de ações sai, ou passa a ser uma "visão de jogador" só para o mestre.
- O mundo da mesa é do mestre: os jogadores leem só o que ele revelar na aba Lore (o servidor não envia o resto).

### Quando
No **back-end**, junto com o §1. Não há como fazer antes: sem servidor, não há quem aplique as regras.
O que dava para preparar (regras e visão como funções puras, sorteio injetável) já está feito.
**Regra a manter daqui até lá:** toda permissão ou visibilidade nova entra em `state/permissions.ts` ou
`state/player-view.ts`, nunca só no template.

---

## 4. Outras pendências antes do back-end

| Item | Por que importa | Quando |
|---|---|---|
| **Exportar/importar mesa e Worldbuild** | Feito na v0.5.0 como cópia inteira do navegador (`.zehenia`, sem base64): ver `CLAUDE.md` §7. Exportar uma mesa do servidor continua pendente. |
| **Arquivos esquecidos ao excluir uma mesa:** `purgeTableData` não apaga as imagens das camadas, as imagens personalizadas de inventário nem as das cópias de ficha dos tokens | Ocupa espaço sem uso; no servidor, vira custo de armazenamento | Ao criar o `FilesRepository` (§2), ou antes, se o espaço virar problema |
| **Ciclo entre features** `game-table` ↔ `worldbuild` | Dificulta separar módulos | **Em parte (v0.7):** `BlobUrlService` foi para `shared/` (lê pelo `BlobReader` da página) e o `QuickActionsService` para `features/tables`. Falta a ficha: o Worldbuild usa a `CharacterSheetView` da mesa, que usa o `TableSessionService` direto em ~40 pontos (única exceção em `scripts/check-deps.mjs`). Ver §6 |
| ~~**Verificação automática das dependências**~~ | ~~A regra só existia no papel~~ | **Feito (v0.7):** `scripts/check-deps.mjs` no `prebuild` (e no CI) |
| ~~**OnPush**~~ | ~~Nenhum componente usava~~ | **Feito (v0.7):** todos os componentes |
| **`GameTablesService.load()`** sem proteção contra trocar de usuário no meio do carregamento | Lista de mesas de outra conta poderia aparecer por um instante | Ao criar o `TablesRepository` (§2) |
| ~~**Desfazer (Ctrl+Z)** só nos desenhos~~ | ~~No multiplayer, precisa virar comando inverso~~ | **Feito (v0.7):** Ctrl+Z/Ctrl+Y de todas as ações do mapa como comandos inversos (`state/undo.ts`), conferidos pelo servidor |

---

## 5. Ordem sugerida da fase de back-end

1. ~~Exportar/importar (§4)~~: feito (cópia do navegador).
2. `FilesRepository` e `AuthGateway` (§2), com autenticação real e convites (o papel vem da conta).
3. `TablesRepository` e `WorldRepository` (§2).
4. Ajustes nos comandos (§1: "definir" em vez de alternar, fichas por campo, transferência atômica).
5. Sala da mesa: snapshot + log de comandos + reconciliação (§1), com o `TableSessionRepository`.
6. Validação de permissões no servidor (§3.3) e rolagens no servidor (§3.2).
7. Projeção por jogador com visão calculada no servidor (§3.1).
8. Eventos efêmeros (ping, efeitos, arraste) e, se necessário, edição colaborativa de texto (Yjs).

Situação (v0.7): 1, 4, 5, 6, 7 e a parte de ping/efeitos do 8 estão feitos; 2 e 3 estão feitos no servidor, mas o
front ainda tem o caminho local em paralelo (§6, item 2).

---

## 6. Guardado para depois

Pendências conhecidas, em ordem sugerida. Nenhuma bloqueia o uso com os amigos.

| # | Item | Por que importa | O que fazer |
|---|---|---|---|
| 1 | **Testes reais na máquina principal** | Tailscale Funnel e backup no Google Drive só foram testados com versões de mentira e pastas temporárias | Seguir o `docs/GUIA-DA-MESA.md` §3–4 (backup, `npm run restaurar`, abrir para os jogadores) e jogar uma sessão |
| 2 | **Remover as mesas e contas locais** (navegador) — **decidido: sai** (2026-11-27) | Hoje há dois caminhos de código: "Neste navegador" (IndexedDB, contas de mentira, dados que o navegador pode apagar) e o servidor | Remover o modo local, levando os dados pela cópia `.zehenia` antes. Os repositórios do §2 viram uma implementação só e o `AuthService` local sai. Feito na máquina de desenvolvimento |
| 3 | **Tailscale embutido** (ponte `tsnet`) | Tiraria a instalação do Tailscale | Desenho em `docs/superpowers/specs/2026-11-06-tailscale-embutido-design.md`, pausado até a máquina principal |
| 4 | **Exportar uma mesa do servidor** | A cópia `.zehenia` só leva o que está no navegador | Rota do dono que monta o arquivo com a mesa e os arquivos dela |
| 5 | **Arquivos esquecidos** | Excluir mesa não apaga imagens das camadas, do inventário e das cópias de ficha dos tokens; desfazer o "colar" de token de NPC com imagens deixa as cópias | Varredura de arquivos sem referência no servidor (e no IndexedDB) |
| 6 | **A ficha fora de `game-table`** | Última exceção da regra de camadas | A `CharacterSheetView` (e inventário, anotações) passar a usar só o `SheetStore`, com as operações da mesa (ações, janelas, rolagens) num contrato próprio; depois, mover para uma feature de fichas |
| 7 | **Funcionalidades em aberto** | — | **Ctrl+Z da ficha** (prioridade: o dono do projeto esperava que já existisse); **mais de 2 mundos** por usuário (vai ser feito); mural de notícias; trancas nas portas. **Descartados** (2026-11-27): peso no inventário e trocar o mundo de uma mesa já criada |
| 8 | **Testes de componentes** | Com o OnPush, pegariam a tela que deixa de atualizar | Começar pelas camadas do mapa e pela ficha |
| 9 | **Dependências de desenvolvimento** | `npm audit` aponta 2 alertas moderados no Vitest do servidor (só desenvolvimento) | Atualizar o Vitest quando houver versão compatível, com autorização do dono do projeto |
| 10 | **Modo Streamer** (futuro, feature grande) | Uma terceira visão da partida, para transmitir | Ver §6.1. **Só anotado**: não começar sem o dono do projeto pedir |

### 6.1 Modo Streamer (ideia anotada em 2026-11-27, não iniciada)

Uma **terceira visão** do jogo, além da do mestre e da do jogador, pensada para transmissão (stream):

- O mestre cria a visão do streamer, que **abre sozinha em outra aba** do navegador.
- A aba mostra **só o mapa**, sem barras nem painéis, e **foca automaticamente nos eventos**: quando um personagem
  rola um dado, quando um item é posto no mapa e quando outras coisas acontecem, a câmera vai até lá e mostra o que
  importa.
- **Rolagens** aparecem com o resultado na tela e depois o chat some.
- O mestre **controla tudo durante a partida** por um **painel do Modo Streamer** dentro do app (o que a visão
  acompanha, o que mostra e quando).

Pontos a decidir quando a feature começar (spec → plano): o que a visão enxerga sob a névoa (provavelmente o mesmo
que os jogadores: um `Viewer` próprio em `state/player-view.ts` e `server/src/realtime/projection.ts`), como a aba
se autentica na mesa online sem uma conta de jogador, e quais eventos geram foco (lista configurável no painel).
