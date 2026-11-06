# Conta do convidado com senha — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o convidado entra com o nome da mesa (único) + senha, de qualquer aparelho, sem convite novo.

**Architecture:** migração 4 acrescenta `users.login_name` (nome normalizado, índice único parcial). O
`AuthService` ganha credenciais de convidado (hash calculado fora das transações) e login por e-mail
(dono) ou nome (convidado). As rotas de convite passam a exigir senha; o link de retorno define uma
senha nova. O front mostra o formulário certo a partir de `POST /invites/info`.

**Tech Stack:** Node 22+/24, Fastify 5, `node:sqlite`, zod 4, Vitest (servidor); Angular 21 zoneless + Material (front).

**Spec:** `docs/superpowers/specs/2026-11-06-conta-do-convidado-design.md`

## Global Constraints

- Senha: 8 a 128 caracteres, sem as mais comuns (`newPassword` / `passwordProblem`), scrypt + pimenta (`PasswordHasher`).
- Nome de entrada = `loginNameOf(nome)`: NFKD sem acentos, minúsculas, espaços únicos, sem bordas. Nome de convidado não pode ter `@`.
- Mensagens (PT-BR, exatas): nome usado → `Esse nome já está em uso. Escolha outro.` (409); login errado → `Nome, e-mail ou senha inválidos.` (401).
- Sessão do convidado: `GUEST_SESSION_DAYS` (180), sem prazo de inatividade (mesmo com senha).
- Toda rota com `strictObject` e limites; eventos de segurança por `audit()`, nunca com senha ou login em texto (usar `ctx.tokens.ref`).
- Hash calculado fora de `transaction(...)`; corrida de nomes resolvida pelo índice único (`SQLITE_CONSTRAINT_UNIQUE` → 409).
- Comentários e textos em PT-BR; commits Conventional em PT-BR na branch `feat/conta-convidado`, com a linha `Co-Authored-By` da sessão.
- Não instalar nada nem usar a pasta real do app nesta máquina (testes só com bancos em memória e pastas temporárias).

## Review Focus

1. Nomes que só diferem em acento, maiúscula ou espaço ("Lýra ", "lyra") → o segundo recebe 409 (Task 2).
2. Nome com `@` num convite novo → 400, sem criar conta nem gastar o convite (Task 2).
3. Dois convites resgatados ao mesmo tempo com o mesmo nome → um 200 e um 409 (o índice segura; Task 1 testa o repositório).
4. Link de retorno de convidado antigo cujo nome já foi tomado → 409 com `nameTaken`, e funciona ao mandar `name` novo (Task 3).
5. Convidado antigo, sem senha, continua usando a sessão; tentar entrar pelo nome dele dá 401 genérico (Task 2).

---

### Task 1: Nome de entrada, migração 4 e repositório

**Files:**
- Create: `server/src/lib/login-name.ts`
- Modify: `server/src/db/migrations.ts` (migração 4), `server/src/repositories/users.ts`
- Test: `server/test/login-name.test.ts` (novo), `server/test/database.test.ts`

**Interfaces:**
- Produces:
  - `loginNameOf(name: string): string`
  - `validGuestName(name: string): boolean` (não vazio depois de normalizar e sem `@`)
  - `PublicUser.hasPassword: boolean` (dono: true; convidado: `password_hash !== NO_PASSWORD`)
  - `UsersRepository.createGuest(id: string, name: string, now: number, credentials: GuestCredentials): PublicUser`
  - `UsersRepository.credentialsByLogin(loginName: string): { user: PublicUser; passwordHash: string } | null` (só `kind = 'guest'`)
  - `UsersRepository.loginTaken(loginName: string, exceptId?: string): boolean`
  - `UsersRepository.setGuestCredentials(id: string, name: string, credentials: GuestCredentials): void`
  - `UsersRepository.renameGuestLogin(id: string, name: string, loginName: string): void`
  - `type GuestCredentials = { loginName: string; passwordHash: string }` (exportado de `users.ts`)
  - `NAME_TAKEN = 'Esse nome já está em uso. Escolha outro.'` e `isUniqueViolation(err: unknown): boolean` (exportados de `users.ts`)

- [ ] **Step 1: testes que falham** — `login-name.test.ts`: `loginNameOf(' Lýra  da  Silva ')` = `'lyra da silva'`; `loginNameOf('LYRA') === loginNameOf('lyra')`; `validGuestName('a@b')` = false; `validGuestName('   ')` = false; `validGuestName('Bia')` = true. Em `database.test.ts`: banco com migrações tem a coluna `login_name`; inserir dois usuários com o mesmo `login_name` lança `isUniqueViolation`; dois com `login_name` NULL passam.
- [ ] **Step 2:** `cd server; npx vitest run test/login-name.test.ts test/database.test.ts` → FAIL (módulo e coluna inexistentes).
- [ ] **Step 3:** implementar `login-name.ts`; acrescentar a migração 4 exatamente como no spec §3; no repositório, `createGuest` grava `login_name` e o hash; `toPublic` inclui `hasPassword`; `isUniqueViolation` reconhece o `errcode`/mensagem `UNIQUE constraint failed` do `node:sqlite`.
- [ ] **Step 4:** mesmo comando → PASS; `npm run typecheck` em `server/` acusa os chamadores de `createGuest` (corrigidos na Task 2: até lá, o `AuthService.createGuest` passa a receber as credenciais).
- [ ] **Step 5:** commit `feat(contas): nome de entrada do convidado (migração 4)`.

### Task 2: Convite novo com senha e login por nome

**Files:**
- Modify: `server/src/services/auth.service.ts`, `server/src/http/routes/auth.ts`, `server/src/http/routes/tables.ts`, `server/test/helpers.ts`, `server/test/http.test.ts`, `server/scripts/smoke.ts`, `server/dev/ws-test.js`, `server/scripts/e2e.ts` (só as chamadas `/auth/login`)

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `AuthService.guestCredentials(name: string, password: string): Promise<GuestCredentials>` — valida (`validGuestName` → 400 `Escolha um nome sem @.`; `passwordProblem(password, name)` → 400) e calcula o hash; não grava nada.
  - `AuthService.createGuest(name: string, credentials: GuestCredentials): PublicUser` — síncrono, para dentro da transação do convite; nome usado → `conflict(NAME_TAKEN)`.
  - `AuthService.login(login: string, password: string, ip: string)` — com `@`: e-mail normalizado (dono, como hoje); sem `@`: `credentialsByLogin(loginNameOf(login))`. Erro 401 `Nome, e-mail ou senha inválidos.`, `dummyVerify` quando não acha, throttle pela chave normalizada.
  - `POST /auth/login` corpo `{ login: string (1..254), password }`.
  - `POST /invites/redeem` convite novo: `{ code, name: text(1, 40), password: newPassword }`.
  - `helpers.redeem(server, code, name = 'Convidado', password = PASSWORD)`.

- [ ] **Step 1: testes que falham** (`http.test.ts`, bloco "convites"): resgatar com `{ code, name: 'Bia', password: PASSWORD }` → 200 e `user.hasPassword` true; sem `password` → 400 e nenhuma conta criada; `name: 'Lýra '` depois de `'lyra'` → 409 `NAME_TAKEN` e o convite continua valendo (um terceiro resgate com outro nome passa); `name: 'a@b'` → 400; entrar com `{ login: ' BIA ', password: PASSWORD }` → 200 e cookie; nome inexistente e senha errada → 401 com o mesmo corpo; convidado antigo (criado direto no banco com `NO_PASSWORD`, sem `login_name`) segue com `/auth/me` 200 e `{ login: nome dele }` → 401; dono entra com `{ login: email }`. Ajustar os testes antigos: `email` → `login` em todo `/auth/login`; `'não-é-email'` passa a dar 401 (não 400); o login com `convidado:<id>` dá 401; o teste "entra só com o nome" vira "entra com nome e senha" (o `toEqual` do usuário ganha `hasPassword: true`).
- [ ] **Step 2:** `cd server; npx vitest run test/http.test.ts` → FAIL nos casos novos.
- [ ] **Step 3:** implementar o `AuthService` e as rotas. No `/invites/redeem`, `await ctx.auth.guestCredentials(name, password)` **antes** de `transaction(...)` (só para convite sem `targetUserId`; o link de retorno é a Task 3 — até lá ele continua como hoje). Corrigir `smoke.ts`, `dev/ws-test.js` e as duas chamadas do `e2e.ts` para `login`.
- [ ] **Step 4:** `cd server; npm test` → todos passam; `npm run typecheck` sem erros.
- [ ] **Step 5:** commit `feat(contas): convidado entra com nome e senha`.

### Task 3: Link de retorno, criar senha, renomear e excluir

**Files:**
- Modify: `server/src/services/auth.service.ts`, `server/src/http/routes/auth.ts`, `server/src/http/routes/tables.ts`, `server/test/http.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces:
  - `POST /invites/info` (público, `AUTH_RATE_LIMIT`), corpo `{ code }` → `{ kind: 'new' }` ou `{ kind: 'return', name: string, nameTaken: boolean }`; código inválido/vencido/gasto → 404 (mesma mensagem do redeem). Não gasta o convite.
  - `POST /invites/redeem` link de retorno: `{ code, password, name? }` → define a senha (e o nome, se veio), encerra as outras sessões, abre uma nova. Nome atual tomado e sem `name` → 409 `NAME_TAKEN`.
  - `AuthService.setGuestPassword(userId: string, name: string, credentials: GuestCredentials): string` — síncrono, na transação; grava, apaga todas as sessões, devolve o token novo.
  - `POST /auth/password/create` `{ password }` (logado, `AUTH_RATE_LIMIT`): só convidado sem senha (senão 409 `Esta conta já tem senha.`); devolve 204 com cookie novo; `hub.userSessionsEnded`; `audit('senha.criada')`.
  - `PATCH /me`: convidado com senha → `validGuestName` + `loginTaken(…, id)` → 409; grava nome e `login_name` juntos.
  - `DELETE /me`: convidado com senha exige `password` correta (401 `Senha incorreta.`), como o dono.

- [ ] **Step 1: testes que falham:** `/invites/info` devolve `new` para convite novo e `{ kind: 'return', name: 'Bia', nameTaken: false }` para o link de retorno, sem gastá-lo; link de retorno com `password` nova → 200, a senha antiga dá 401, a nova entra, o cookie antigo dá 401 em `/auth/me`; convidado antigo sem senha cujo nome outro já usa → `info` com `nameTaken: true`, redeem sem `name` → 409, com `name: 'Bia 2'` → 200; `password/create` → 204 e depois entra pelo nome; segunda vez → 409; dono → 409; renomear para um nome usado → 409, para um livre → entra com o novo nome; `DELETE /me` de convidado com senha sem `password` → 401, com a certa → 204.
- [ ] **Step 2:** `cd server; npx vitest run test/http.test.ts` → FAIL nos casos novos.
- [ ] **Step 3:** implementar. Eventos: `audit('senha.redefinida_por_link', { userId, tableId, ip })`.
- [ ] **Step 4:** `cd server; npm test` e `npm run typecheck` → passam.
- [ ] **Step 5:** commit `feat(contas): link de retorno define a senha; criar senha pelo menu`.

### Task 4: Front-end

**Files:**
- Modify: `src/app/core/models/user.model.ts`, `src/app/core/services/server-account.service.ts`, `src/app/features/auth/invite/invite.ts|.html`, `src/app/features/auth/sign-in/sign-in.ts|.html`, `src/app/features/tables/online-tables/online-tables.ts|.html`

**Interfaces:**
- Consumes: rotas das Tasks 2–3.
- Produces:
  - `User.hasPassword?: boolean`
  - `ServerAccountService.login(login: string, password: string)`, `inviteInfo(code: string): Promise<{ kind: 'new' } | { kind: 'return'; name: string; nameTaken: boolean }>`, `redeem(code: string, input: { name?: string; password: string })`, `createPassword(password: string)`, `changePassword(current: string, next: string)`.

- [ ] **Step 1:** convite: ao ter o código, chama `inviteInfo` (erro → mensagem e botão desabilitado). `kind: 'return'` → "Olá, {nome}" + senha nova + repetir (+ campo de nome se `nameTaken`), sempre via `redeem`, mesmo logado. `kind: 'new'` e logado → `tables.accept` como hoje; sem conta → nome + senha + repetir. Senhas diferentes → erro local, sem chamar o servidor. Textos: título "Você foi convidado"; dica "Com o nome e a senha, você entra de qualquer aparelho em Entrar."
- [ ] **Step 2:** entrar: campo "E-mail ou nome" (`autocomplete="username"`), dica "Jogadores: use o nome da mesa."
- [ ] **Step 3:** Mesas online: no menu da conta, "Criar senha" (`!hasPassword`) ou "Trocar senha" (convidado com senha), num formulário em linha como o de excluir; aviso âmbar acima das mesas para convidado sem senha ("Crie uma senha para entrar de outros aparelhos."). Excluir conta pede a senha também ao convidado com senha.
- [ ] **Step 4:** `npm run build` (raiz) sem erros nem avisos novos; `npx ng test --watch=false` passa.
- [ ] **Step 5:** commit `feat(contas): telas de convite, entrada e senha do convidado`.

### Task 5: e2e e documentação

**Files:**
- Modify: `server/scripts/e2e.ts`, `CLAUDE.md` (§1, §7 "Contas"), `server/README.md`, `BACKEND_SECURITY.md` §1, `ARCHITECTURE.md` (linha "Só por convite")

- [ ] **Step 1:** e2e: a amiga resgata com nome e senha (o campo de senha e o de repetir são preenchidos); numa janela nova, ela entra pela página `/entrar` com nome e senha e vê a mesa; o link de retorno passa pelo formulário de senha nova (o texto `check` "entra só com o nome, sem cadastro nem senha" é reescrito).
- [ ] **Step 2:** `npm run build` (raiz) e `cd server; npm run e2e` → "Tudo certo" (usa pasta temporária e Tailscale de mentira; nada fora do repositório e do temp).
- [ ] **Step 3:** atualizar a documentação listada (regras do spec §2 em CLAUDE.md §7; rotas no README; login do convidado no BACKEND_SECURITY §1).
- [ ] **Step 4:** commit `docs(contas): conta do convidado com senha` e merge `--no-ff` de `feat/conta-convidado` na `main`.
