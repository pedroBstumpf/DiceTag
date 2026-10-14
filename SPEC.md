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
| Projeção por jogador (cena aberta, sem notas secretas, fichas de NPC liberadas, sem ações do mestre) | `realtime/projection.ts` | §3.1, exceto visão/névoa (paredes e tokens sob a névoa ainda são enviados) |
| Rolagem no servidor (`crypto.randomInt`, níveis dos temas da ficha atual, gasto de Espírito) | `realtime/rolls.ts` | §3.2 (etiquetas de itens, status e estudos ainda valem 0) |
| Papel vindo da conta (dono = mestre, convite = jogador) e permissões por comando | `realtime/command-rules.ts` | §3.3 |

---

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
| `toggleDoor`, `toggleTokenPublic`, `toggleLoreReveal` | Dois cliques ao mesmo tempo se anulam | Trocar por "definir" com o valor final: `setDoorOpen { open }`, `setTokenPublic { part, value }`… |
| Ficha gravada inteira (`updateEntry { sheet }`, `updatePlacement { sheet }` montados com `{ ...fichaAtual, ...patch }`) | Um apaga a alteração do outro: o cliente lê a ficha, muda um campo e regrava tudo | Comandos de ficha por campo ou por item: `setSheetField`, `addInventoryItem`, `setInventoryQuantity`, `setTagLevel`… |
| `transferItem`, `buyItem`, `lootItem` (várias gravações no cliente) | Dois jogadores comprando a última unidade duplicam o item | **Um comando só, executado no servidor**, que confere estoque e Eiros e faz tudo de uma vez |
| `updateScene { patch }` genérico | O servidor não sabe o que está sendo alterado (permissão) | Comandos específicos para os campos que o jogador pode mexer; o patch genérico fica só para o mestre |
| Memória da névoa (`setExplored`) gravada pelo cliente | Cada cliente teria uma máscara diferente | Calcular no servidor a partir das posições oficiais dos tokens, ou guardar uma máscara por jogador |

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

abstract class FilesRepository {         // mapas, imagens, áudios (hoje "blob:<id>")
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
| **Exportar/importar mesa e Worldbuild** (arquivo com estado + arquivos em base64, ids de arquivos regerados ao importar) | Única proteção contra o usuário limpar os dados do site; vira a ferramenta de migração dos dados locais para o servidor | **Antes do back-end** (é o caminho de migração) |
| **Arquivos esquecidos ao excluir uma mesa:** `purgeTableData` não apaga as imagens das camadas, as imagens personalizadas de inventário nem as das cópias de ficha dos tokens | Ocupa espaço sem uso; no servidor, vira custo de armazenamento | Ao criar o `FilesRepository` (§2), ou antes, se o espaço virar problema |
| **Ciclo entre features** `game-table` ↔ `worldbuild` (a ficha da mesa é usada no bestiário) e `shared` → `features` (`QuickActionsService`) | Dificulta separar módulos e verificar a regra de dependências | Antes de crescer mais: mover `BlobUrlService` para `shared/`; expor cada feature por um `index.ts`; tirar a ficha de `game-table` |
| **Verificação automática das dependências** entre camadas | Hoje a regra só existe no papel | Junto com o item anterior. Sugestão sem dependências novas: script Node no `prebuild` |
| **OnPush:** nenhum dos 50 componentes usa | Com signals e zoneless, o OnPush reduz o trabalho de detecção de mudanças, o que vale na mesa (muitos componentes vivos) | Pode ser feito a qualquer momento, componente por componente, começando pelas camadas do mapa |
| **`GameTablesService.load()`** sem proteção contra trocar de usuário no meio do carregamento | Lista de mesas de outra conta poderia aparecer por um instante | Ao criar o `TablesRepository` (§2) |
| **Desfazer (Ctrl+Z)** só nos desenhos, numa pilha local | No multiplayer, desfazer precisa virar um comando inverso enviado ao servidor (`restoreStrokes` já existe) | Junto com o §1 |

---

## 5. Ordem sugerida da fase de back-end

1. Exportar/importar (§4): garante a migração dos dados locais.
2. `FilesRepository` e `AuthGateway` (§2), com autenticação real e convites (o papel vem da conta).
3. `TablesRepository` e `WorldRepository` (§2).
4. Ajustes nos comandos (§1: "definir" em vez de alternar, fichas por campo, transferência atômica).
5. Sala da mesa: snapshot + log de comandos + reconciliação (§1), com o `TableSessionRepository`.
6. Validação de permissões no servidor (§3.3) e rolagens no servidor (§3.2).
7. Projeção por jogador com visão calculada no servidor (§3.1).
8. Eventos efêmeros (ping, efeitos, arraste) e, se necessário, edição colaborativa de texto (Yjs).
