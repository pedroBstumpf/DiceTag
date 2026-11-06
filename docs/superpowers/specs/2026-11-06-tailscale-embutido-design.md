# Tailscale embutido (ponte `tsnet`) — tarefa pausada

Data: 2026-11-06 · Situação: **PAUSADA** — retomar na máquina principal (a de desenvolvimento atual não deve
receber o Go nem testes do Tailscale).

## 1. Objetivo

Hoje o `npm run mesa` usa o **app do Tailscale instalado** para abrir o Funnel (`server/scripts/lib/funnel.ts`
chama `tailscale.exe`). A meta é que a mesa chegue à internet **sem instalar o Tailscale**: uma pequena "ponte"
em Go, com a biblioteca [`tsnet`](https://pkg.go.dev/tailscale.com/tsnet), entra sozinha na conta Tailscale do
dono (já existe, conectada pelo Google) e abre o Funnel para o servidor da mesa.

Os jogadores continuam sem instalar nada (só o navegador).

## 2. Decisões já tomadas pelo dono do projeto

| Pergunta | Decisão |
|---|---|
| Caminho (nuvem, `tsnet` ou Supabase/Firebase) | **`tsnet`**: a mesa continua no PC do dono, de graça |
| Como o `.exe` da ponte chega à máquina principal | **GitHub Releases**: o GitHub Actions compila e publica; o `Iniciar mesa` baixa na primeira vez e confere o SHA-256 |
| Login da ponte na primeira vez | **Link no terminal**: a janela mostra o link, o dono entra com o Google; o estado fica na pasta do app |
| App do Tailscale instalado | **Manter os dois**: usa a ponte quando existir; sem ela, o Tailscale instalado (como hoje) |
| Onde desenvolver | **Na máquina principal**, com o Go instalado lá (nada de Go nesta máquina de desenvolvimento) |

## 3. Desenho proposto (para revisar ao retomar)

### Ponte (`ponte/`, módulo Go)

- Programa `zehenia-ponte` com `tsnet.Server{ Hostname: "zehenia-mesa", Dir: <pasta do app>\tailscale }`.
- Conversa com o `npm run mesa` por **linhas JSON**:
  - saída: `{"type":"login","url":"https://login.tailscale.com/…"}`, `{"type":"running","url":"https://zehenia-mesa.<rede>.ts.net"}`,
    `{"type":"open"}`, `{"type":"closed"}`, `{"type":"error","message":"…"}`;
  - entrada (stdin): `open`, `close`. **stdin fechado = a ponte encerra**: ela morre junto com a mesa,
    inclusive no Windows, quando a janela é fechada à força.
- `open` → `ListenFunnel("tcp", ":443")` (TLS e certificado automáticos) + `httputil.ReverseProxy` para
  `http://127.0.0.1:<porta>`; `close` fecha o listener (a mesa sai da internet).
- **Segurança, igual ao túnel de hoje** (`server/src/http/routes/host.ts`, `isDirectLocal`): a ponte mantém o
  `Host` público (`*.ts.net`), envia `X-Forwarded-For`, `X-Forwarded-Proto` e `Tailscale-Funnel-Request`.
  Assim, nada vindo da internet passa por "pedido do próprio computador", e abrir ou fechar a mesa continua só
  local.
- Nenhum argumento vem do navegador: a porta e as pastas são fixas, passadas pelo `npm run mesa`.

### Lado Node (`server/scripts/lib/funnel.ts`)

- Duas implementações do mesmo contrato (`status`, `open`, `close`, `stop`, `publicUrl`, `clearLeftover`),
  que devolvem o mesmo `HostStatus` (`server/src/ops/tailscale.ts`). O painel do app (`HostPanel`) não muda.
  - `PonteFunnel`: escolhida quando o `.exe` da ponte existe.
  - `TailscaleFunnel`: a de hoje, como alternativa.
- **Primeira vez:** o `npm run mesa` inicia a ponte **antes** do servidor. Se vier `login`, mostra o link no
  terminal e espera a conexão, ou segue sem ela se o dono apertar Enter. Assim, o endereço público já entra em
  `ALLOWED_ORIGINS` e `PUBLIC_URL`, e os convites saem com o endereço `ts.net`.
- **Funnel não liberado na conta:** um erro do `ListenFunnel` vira o estado `approval`, com o link do painel do
  Tailscale. **Conferir na máquina principal** qual mensagem o `tsnet` devolve e qual link mostrar.
- **Testes:** um `ponte-falsa.mjs` falando o mesmo protocolo, como o `tailscale-falso.mjs` de hoje, para o
  `npm run e2e`. Funções puras de leitura do protocolo, com teste.

### Distribuição

- `.github/workflows/ponte.yml`: em cada tag `ponte-v*`, compila `GOOS=windows GOARCH=amd64` (e, se útil,
  Linux e macOS), roda `go vet` e `go test` e publica o `.exe` num Release com o SHA-256.
- `server/ponte.json`: versão e SHA-256 esperados. O `npm run mesa` baixa
  `https://github.com/pedroBStumpf/DiceTag/releases/download/ponte-v<versão>/zehenia-ponte.exe` para
  `server/.mesa/` (fora do git), confere o hash e só então usa.
- **Atenção:** download sem login só funciona com o **repositório público**. Se ele continuar privado, a
  alternativa é baixar o `.exe` à mão no GitHub e colocar em `server/.mesa/`. Decidir ao retomar.

## 4. Pontos a validar na máquina principal

1. Instalar o Go (https://go.dev/dl/) e conferir a versão mínima exigida pelo `tailscale.com/tsnet` atual.
2. No painel do Tailscale: HTTPS ligado e o atributo de Funnel liberado para o novo aparelho `zehenia-mesa`.
3. Mensagem de erro do `ListenFunnel` sem Funnel liberado (para o estado `approval`).
4. O IP real de quem chega pelo Funnel está disponível para o `X-Forwarded-For` (o limite de taxa do servidor
   usa o IP).
5. O antivírus e o SmartScreen aceitam o `.exe` sem assinatura. Se não aceitarem, avaliar assinar o executável.
6. A ponte e o app do Tailscale instalado convivendo na mesma máquina (são aparelhos diferentes na rede).

## 5. Como retomar

1. Na máquina principal, com o Go instalado, revisar este documento com o Claude Code (o caminho é
   arquitetural: este desenho vira o spec, e depois vem o plano de implementação).
2. Decidir: repositório público ou download manual (seção 3, "Distribuição").
3. Escrever o plano (`docs/superpowers/plans/`) e implementar com TDD.
4. Atualizar o `docs/GUIA-DA-MESA.md`: o Tailscale deixa de ser instalado, mas a conta e a liberação do Funnel
   continuam necessárias.
