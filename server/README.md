# Servidor — Crônicas de Zehenia

Back-end do VTT: **API HTTP** (contas, mesas, convites, mundos, arquivos) + **sala da mesa por
WebSocket** (comandos em tempo real, validados e aplicados pelo servidor).

Node.js + TypeScript · Fastify · `ws` · zod · SQLite embutido no Node (`node:sqlite`) · Vitest.
Roda só na sua máquina: nada é publicado.

> **Estado atual:** o servidor está pronto e testado, mas o **front-end ainda não o usa** (continua
> guardando tudo no IndexedDB). A ligação entre os dois é a próxima etapa (ver [Próximos passos](#próximos-passos)).
> Até lá, teste o servidor pela página `/dev/` e pelos scripts abaixo.

---

## 1. Preparar (uma vez só)

Pré-requisito: **Node.js 22.13 ou mais novo** (o seu é o 24). Nada mais: sem Docker, sem banco para instalar.

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

---

## 3. Testar

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
npm test            # 81 testes: unidade + integração (HTTP e WebSocket reais, banco em memória)
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
| `Muitas tentativas para este e-mail` (`429`) | Bloqueio após 5 senhas erradas: espere 15 minutos ou reinicie o servidor. |
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
| `POST /auth/register` · `POST /auth/login` · `POST /auth/logout` | Conta e sessão (cookie) |
| `GET/PATCH /auth/me` · `POST /auth/password` | Conta atual, nome, troca de senha |
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
  (ping/efeito, não salvo) e `sync`.
- Servidor responde `welcome` (estado inicial), `ack`/`nack` (aceito/recusado), `cmd` (para o mestre),
  `state` (para jogadores: o estado já filtrado), `event` e `error`.

### Segurança

- **Senhas:** scrypt (custo da OWASP) + sal + "pimenta" fora do banco; mínimo de 8 caracteres e recusa
  das mais comuns. Login com a mesma resposta e o mesmo tempo para e-mail inexistente e senha errada;
  bloqueio do e-mail após 5 erros.
- **Sessão:** token aleatório num cookie `HttpOnly` + `Secure` + `SameSite=Strict` (`__Host-`); o banco guarda
  só o HMAC. Expira em 7 dias (ou 24 h sem uso). Logout e troca de senha valem na hora, inclusive no WebSocket.
- **CSRF e WebSocket de outro site:** toda alteração e todo WebSocket exigem uma origem da lista.
- **Autorização:** o papel vem da conta (dono = mestre). Todo comando da mesa é validado (formato e
  permissão) com as mesmas regras do front-end. Recurso de outra conta responde 404.
- **O jogador só recebe o que pode ver:** cena aberta, sem anotações secretas, sem fichas de NPC não
  liberadas, sem ações do mestre.
- **Rolagens no servidor**, com gerador criptográfico e níveis lidos da ficha atual.
- **Entrada:** tudo validado (zod); JSON com `__proto__` recusado; limites de tamanho e profundidade.
- **Arquivos:** tipo conferido pelos bytes (SVG/HTML recusados), nome gerado pelo servidor, cota por
  conta, download com `nosniff` e CSP `sandbox`.
- **Abuso:** limite de requisições por IP, de mensagens por conexão e de conexões por conta.
- **Cabeçalhos:** CSP, `X-Frame-Options: DENY`, `nosniff`, sem `Referer`; HSTS em produção.
- **Segredos e logs:** segredos só no `.env` (validados ao subir); logs escondem cookies e senhas;
  erros não mostram detalhes internos.
- **Dependências:** versões exatas, lockfile, `ignore-scripts`, `npm audit` sem vulnerabilidades.

---

## Próximos passos

1. **Ligar o front-end ao servidor** (SPEC.md §2): repositórios por domínio no front (contas, mesas,
   mundos, arquivos), com a implementação HTTP trocando a do IndexedDB, e o `TableSessionService`
   enviando os comandos pelo WebSocket (SPEC §1). O IndexedDB continua como modo offline.
2. Comandos atômicos no servidor para compra, loot, largar/pegar itens e ficha por campo (SPEC §1).
3. Visão e névoa calculadas no servidor (o jogador deixa de receber paredes e tokens fora da visão).
4. Antes de publicar: HTTPS (proxy reverso), `NODE_ENV=production`, backup do banco e e-mail de verificação.

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
│   ├── services/          # contas e sessões
│   ├── security/          # senha, tokens, origem, cookie, tipo de arquivo
│   ├── lib/               # erros, ids, JSON seguro, limitadores, esquemas
│   ├── http/              # plugins (segurança, sessão) e rotas
│   └── realtime/          # sala da mesa: protocolo, esquemas, regras, projeção, rolagem
├── scripts/               # setup, seed, smoke
├── dev/                   # página /dev/
└── test/                  # testes Vitest
```
