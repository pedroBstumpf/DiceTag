# Servidor — Crônicas de Zehenia

Back-end do VTT: **API HTTP** (contas, mesas, convites, mundos, arquivos) + **sala da mesa por
WebSocket** (comandos em tempo real, validados e aplicados pelo servidor).

Node.js + TypeScript · Fastify · `ws` · zod · SQLite embutido no Node (`node:sqlite`) · Vitest.
Roda só na sua máquina: nada é publicado.

> **Estado atual:** o servidor está pronto e testado, e o app já o usa na **mesa online** (seção "Mesas online"
> em Minhas mesas, ver §3.0). O resto do app continua no IndexedDB (ver [Próximos passos](#próximos-passos)).
> Também dá para testar pela página `/dev/` e pelos scripts abaixo.

---

## 1. Preparar (uma vez só)

Pré-requisito: **Node.js 22 (22.13+) ou 24**, as linhas LTS (versão usada em `.nvmrc`). Nada mais: sem Docker,
sem banco para instalar.

Num terminal, na pasta `server/`:

```bash
cd server
npm install        # instala as dependências (scripts de instalação bloqueados pelo .npmrc)
npm run setup      # cria o .env com segredos aleatórios (não sobrescreve um .env existente)
npm run seed       # cria as contas de exemplo e uma mesa de testes
```

Contas criadas pelo `seed` (dados fictícios):

| Conta | E-mail | Senha |
|---|---|---|
| Mestre (dono da mesa) | `mestre@zehenia.local` | o valor de `SEED_PASSWORD` no arquivo `server/.env` |
| Jogadora (convidada) | `jogador@zehenia.local` | o mesmo `SEED_PASSWORD` |

A mesa de exemplo tem uma anotação pública e uma **secreta**, um NPC com ficha secreta, uma parede,
uma porta e uma segunda cena "em preparação". Assim dá para ver o que o mestre recebe e o que a jogadora
**não** recebe.

> O `.env` guarda segredos: **nunca** o envie para o Git nem para outra pessoa (o `.gitignore` já o protege).

---

## 2. Abrir o servidor

```bash
cd server
npm run dev        # reinicia sozinho quando um arquivo muda
# ou: npm start    # sem reiniciar sozinho
```

Fica em `http://localhost:3000`, acessível **só desta máquina** (`HOST=127.0.0.1`). Para parar: **Ctrl+C**
(as mesas abertas são gravadas antes de desligar).

### Abrir o front-end junto (dois terminais)

| Terminal 1 (pasta `server/`) | Terminal 2 (pasta raiz do projeto) |
|---|---|
| `npm run dev` → `http://localhost:3000` | `npm start` → `http://localhost:4200` |

O `ng serve` já repassa `/api` e `/ws` para o servidor (`proxy.conf.json` na raiz). Para o navegador,
front e back ficam na mesma origem (`localhost:4200`), e o cookie de sessão funciona sem ajustes.

### Jeito leve: um processo só (sem o `ng serve`)

O `ng serve` é o processo mais pesado (compila e fica observando os arquivos). Para só **usar** o app,
compile uma vez e deixe o servidor entregá-lo:

```bash
npm run build        # na raiz do projeto (de novo só quando o front mudar)
cd server
npm start            # http://localhost:3000 — app + API + WebSocket
```

Precisa de `FRONTEND_DIR=../dist/zehenia/browser` no `server/.env` (já vem no `.env.example`; num `.env`
antigo, acrescente a linha). Sem o build, o servidor avisa no log e entrega só a API. O app usa a mesma
origem (`localhost:3000`), então cookie e WebSocket funcionam igual. Rotas do app (`/mesas`,
`/mesa-online/...`) caem no `index.html`; `/api`, `/ws` e `/dev` continuam do servidor. A CSP do app
(`frontendCsp` em `http/routes/frontend.ts`) só aceita scripts do próprio servidor: por isso o build não
põe CSS crítico inline (`inlineCritical: false` no `angular.json`).

---

## 3. Testar

### 3.0 Pelo app (localhost:4200): a mesa online

Com os dois terminais abertos (servidor e `npm start`, ver §2) — ou só o servidor no jeito leve, trocando
`localhost:4200` por `localhost:3000`:

1. Abra **http://localhost:4200/mesas** e role até **Mesas online**. Clique em **Entrar no servidor** e use
   `mestre@zehenia.local` com a senha `SEED_PASSWORD` do `.env`.
2. Na "Mesa de testes" (papel **Mestre**), clique em **Abrir mesa online**. A barra de cima mostra **Online**.
3. Numa **janela anônima** (outra sessão de cookies), repita com `jogador@zehenia.local`: a mesa aparece como
   **Jogador**.
4. Lado a lado, confira:
   - o mestre vê as 2 cenas e as 2 anotações; a jogadora vê 1 cena e só a anotação pública;
   - mover o token da Lyra numa janela aparece na outra; o goblin não se move pela jogadora (aviso
     "O servidor recusou…");
   - ligar a névoa (mestre, ferramenta Névoa) muda o que a jogadora vê, com a visão calculada pelo servidor;
   - chat e rolagens (barra de baixo ou "Rolar") aparecem para os dois; o resultado é sorteado no servidor.
5. Convites: no menu da mesa, **Gerar convite**; com outra conta (crie uma em "Criar conta"), cole o código em
   **Código de convite** → **Entrar**.
6. LGPD: menu da conta → **Baixar meus dados** ou **Excluir conta do servidor** (pede a senha).

Ainda locais na mesa online: imagens, mapas e sons enviados (ficam só no navegador de quem enviou), Worldbuild e
bestiário, pings e efeitos especiais.

### 3.1 Página de testes no navegador (o jeito mais visual)

Com o servidor aberto, acesse **http://localhost:3000/dev/** (use `localhost`, não o IP).

1. **Conta:** digite um e-mail do seed e a senha (`SEED_PASSWORD`) → **Entrar**.
2. **Mesas:** clique em "Mesa de testes" para selecioná-la.
3. **Sala:** **Conectar na mesa selecionada**. Em "Estado recebido" aparece o que esta conta enxerga.
4. Teste os botões (mensagem no chat, rolar 2d12, mover token) e a **Mensagem livre (JSON)**.

Para ver as duas visões ao mesmo tempo, abra uma **janela anônima** (ou outro navegador), entre como
jogadora e conecte na mesma mesa. Repare:
- o mestre recebe 2 cenas e 2 anotações; a jogadora recebe 1 cena e 1 anotação;
- a jogadora não consegue mover o goblin nem atravessar a parede (resposta `nack`);
- o que um faz aparece na hora para o outro.

A página só existe com `DEV_TOOLS=true` no `.env`. O servidor se recusa a subir com isso em produção.

### 3.2 Teste de ponta a ponta automático

Com o servidor aberto (terminal 1), num segundo terminal:

```bash
cd server
npm run smoke
```

Ele faz login como mestre e jogadora e confere, passo a passo, CSRF, WebSocket de outra origem,
projeção, comando permitido, comando recusado, parede, chat, rolagem no servidor e mensagem inválida.
No fim, mostra "Tudo certo.".

### 3.3 Testes automatizados (não precisam do servidor aberto)

```bash
cd server
npm test            # 127 testes: unidade + integração (HTTP e WebSocket reais, banco em memória)
npm run typecheck   # checagem de tipos
npm run check       # typecheck + testes + npm audit
```

Os testes do servidor rodam **um arquivo por vez** (pouca memória). Os do front-end (`npx ng test
--watch=false`, na raiz) abrem vários processos em paralelo e podem esgotar a memória numa máquina com
pouca RAM livre: feche programas pesados antes ou rode-os sozinhos.

---

## 4. Dicas e problemas comuns

| Situação | O que fazer |
|---|---|
| `Configuração inválida (arquivo .env)` | Rode `npm run setup` (ou corrija o item listado no erro). |
| Login recusado (`401`) | Confira a senha em `SEED_PASSWORD` do `.env` e rode `npm run seed`. |
| `Muitas tentativas para este e-mail` (`429`) | Atraso crescente: depois de 5 senhas erradas do mesmo IP, a espera dobra a cada erro (30 s até 15 min). A mensagem diz quantos segundos; reiniciar o servidor zera. |
| `TRUST_PROXY foi substituído por TRUSTED_PROXIES` | Apague `TRUST_PROXY` do `.env` (ou deixe `false`). Atrás de um proxy, liste o IP dele em `TRUSTED_PROXIES`. |
| `Origem não autorizada` (`403`) | Use `http://localhost:...`. Outra origem? Acrescente em `ALLOWED_ORIGINS` no `.env`. |
| `EADDRINUSE` na porta 3000 | Já há um servidor aberto. Feche-o (Ctrl+C no outro terminal) ou mude `PORT` no `.env` **e** no `proxy.conf.json`. |
| Começar do zero | Pare o servidor e apague a pasta `server/data/` (banco e arquivos de teste). **Apaga tudo** o que foi criado no servidor. Depois, `npm run seed`. |
| Pouca memória | Cada login usa ~128 MB por um instante (scrypt com o custo recomendado). Para economizar só em desenvolvimento, use `PASSWORD_COST=15` no `.env`. Em produção o servidor exige 17. |

O aviso `ExperimentalWarning: SQLite` (se aparecer) é normal: o `node:sqlite` ainda é marcado como
experimental no Node. Os scripts já o escondem.

---

## 5. O que o servidor faz

### API HTTP (`/api`)

| Rota | O quê |
|---|---|
| `POST /auth/register` · `POST /auth/login` · `POST /auth/logout` | Conta e sessão (cookie) — as únicas rotas públicas, com `/health` |
| `POST /auth/logout-all` | Sair de todos os dispositivos |
| `GET/PATCH /auth/me` · `POST /auth/password` | Conta atual, nome, troca de senha (renova a sessão) |
| `GET /auth/me/export` · `DELETE /auth/me` | LGPD: baixar os próprios dados; excluir a conta (pede a senha) |
| `GET/POST /tables` · `GET/PATCH/DELETE /tables/:id` | Mesas da conta (como mestre ou jogador) |
| `GET /tables/:id/members` · `DELETE /tables/:id/members/:userId` | Membros (mestre remove, jogador sai) |
| `POST/DELETE /tables/:id/invites` · `POST /invites/accept` | Convites (código mostrado uma vez, 7 dias) |
| `GET /tables/:id/lore` | Itens do mundo da mesa (jogador: só os revelados) |
| `GET/POST /worlds` · `PATCH/DELETE /worlds/:id` | Mundos (até 2) |
| `GET /worlds/:id/items` · `PUT/DELETE /worlds/:id/items/:itemId` · `POST /worlds/:id/items/delete` | Worldbuild |
| `POST /files?tableId=…` ou `?worldId=…` · `GET/DELETE /files/:id` | Imagens e áudios |
| `GET /health` | Servidor no ar |

### Sala da mesa (`ws://…/ws/tables/:id`)

Mensagens JSON com o campo `t`; o protocolo completo está em `src/realtime/protocol.ts`.

- Cliente envia `cmd` (um dos 49 comandos da mesa, os mesmos do `TableSessionService`), `roll`, `event`
  (ping/efeito, não salvo) e `sync`. Cada tipo tem o próprio limite de tamanho (`realtime/budgets.ts`).
- Servidor responde `welcome` (estado inicial), `ack`/`nack` (aceito/recusado), `cmd` (para o mestre),
  `state` (para jogadores: o estado já filtrado, só quando muda para eles), `event` e `error`.
- Com névoa, `welcome`/`state` levam `vision`: os polígonos de visão calculados no servidor. O jogador
  não recebe as paredes (revelariam a planta), só as portas que já viu.

### Segurança

As regras completas estão no [`BACKEND_SECURITY.md`](../BACKEND_SECURITY.md); a operação em produção, no
[`OPERATIONS.md`](OPERATIONS.md).

- **Senhas:** scrypt (custo da OWASP) + sal + "pimenta" fora do banco, com a versão da pimenta no hash
  (dá para trocá-la sem invalidar senhas). Política no zod: 8 a 128 caracteres, sem as mais comuns.
  Login com a mesma resposta e o mesmo tempo para e-mail inexistente e senha errada; atraso crescente
  por e-mail + IP e por e-mail.
- **Sessão:** token aleatório num cookie `HttpOnly` + `Secure` + `SameSite=Strict` (`__Host-`); o banco guarda
  só o HMAC. Expira em 7 dias (ou 24 h sem uso). Logout, "sair de todos" e troca de senha (que renova a
  sessão) valem na hora, inclusive no WebSocket.
- **CSRF e WebSocket de outro site:** toda alteração e todo WebSocket exigem o cabeçalho `Origin` com uma
  origem da lista.
- **Autorização:** toda rota exige sessão, menos as públicas da lista. O papel vem da conta (dono =
  mestre). Dono e participação são conferidos dentro das consultas SQL. Recurso de outra conta responde 404.
- **Comandos da mesa:** formato estrito (inclusive a ficha, com os limites das regras do jogo) e
  permissão, com as mesmas regras do front-end. O jogador não muda o máximo das barras de status; a raça
  é aplicada pelo servidor com a Raça do mundo; paredes valem em todo movimento dele.
- **O jogador só recebe o que pode ver:** cena aberta; com névoa, só tokens, anotações, itens, efeitos e
  portas à vista (visão calculada no servidor), sem as paredes; sem fichas de NPC não liberadas, sem
  NPCs fora da vista, sem ações do mestre, sem sons.
- **Rolagens no servidor**, com gerador criptográfico obrigatório e níveis lidos da ficha atual.
- **Entrada:** tudo validado (zod); JSON com `__proto__` recusado; limites de tamanho e profundidade.
- **Arquivos:** recebidos em streaming; tipo conferido pelos bytes, pela extensão e pelo tipo declarado
  (SVG/HTML recusados); nome gerado pelo servidor; cotas por conta e por mesa, conferidas no registro;
  download com `nosniff` e CSP `sandbox`.
- **Abuso:** limite de requisições por IP (o IP real só atrás dos proxies de `TRUSTED_PROXIES`), de
  mensagens e tamanho por conexão e de conexões por conta.
- **Cabeçalhos:** CSP, `X-Frame-Options: DENY`, `nosniff`, sem `Referer`; HSTS em produção.
- **Segredos e logs:** segredos só no `.env` (validados ao subir); eventos de segurança no log (campo
  `security`), sem senhas, cookies, tokens nem e-mails; erro 500 só com o `requestId`.
- **Banco:** arquivo 600, migrações registradas em `schema_migrations`, backup antes de migrar.
- **LGPD:** exportar os dados e excluir a conta (em cascata). Backup com teste de restauração
  (`npm run backup`, `npm run backup:check`).
- **Dependências:** versões exatas, lockfile, `ignore-scripts`, `npm audit` sem vulnerabilidades.

---

## Próximos passos

1. **Terminar de ligar o front-end ao servidor** (SPEC.md §2): a mesa online já envia os comandos pelo
   WebSocket e usa a `vision` do servidor; faltam os repositórios por domínio (arquivos, mundos/Worldbuild,
   contas) com a implementação HTTP trocando a do IndexedDB, os eventos efêmeros (ping, efeitos) e remover os
   metadados (EXIF) das imagens antes de enviar. O IndexedDB continua como modo offline.
2. Comandos atômicos no servidor para compra, loot, largar/pegar itens e ficha por campo (SPEC §1).
3. Memória da névoa calculada no servidor (hoje o cliente do mestre a grava) e etiquetas de itens,
   status e estudos nas rolagens do servidor.
4. Antes de publicar: seguir o [`OPERATIONS.md`](OPERATIONS.md) (HTTPS, `NODE_ENV=production`, segredos,
   backups, política de privacidade) e verificação de e-mail.

## Estrutura

```
server/
├── src/
│   ├── main.ts            # sobe o servidor e desliga com cuidado
│   ├── app.ts             # monta HTTP + WebSocket (usado também pelos testes)
│   ├── config/env.ts      # .env validado
│   ├── db/                # SQLite + migrações
│   ├── domain/index.ts    # regras puras importadas do front-end (mesma lógica dos dois lados)
│   ├── repositories/      # único lugar com SQL
│   ├── services/          # contas e sessões; exportar e excluir conta (LGPD)
│   ├── security/          # senha, tokens, origem, cookie, tipo de arquivo, atraso no login
│   ├── lib/               # erros, ids, JSON seguro, limitadores, esquemas, IP real, envio em streaming, auditoria
│   ├── http/              # plugins (segurança, sessão) e rotas
│   ├── realtime/          # sala da mesa: protocolo, limites, esquemas, regras (e da ficha), visão, projeção, rolagem
│   └── ops/               # backup e teste de restauração
├── scripts/               # setup, seed, smoke, backup, backup-check
├── OPERATIONS.md          # operação segura em produção
├── dev/                   # página /dev/
└── test/                  # testes Vitest
```
