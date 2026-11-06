# Conta do convidado com senha — desenho

Data: 2026-11-06 · Situação: aguardando revisão do dono do projeto

## 1. Objetivo

Hoje o convidado entra pelo link de convite só com um nome, e a única credencial dele é o cookie da
sessão (180 dias). Outro aparelho, outro navegador ou cookies apagados exigem um link de retorno.

**Meta:** o jogador convidado tem uma conta simples (nome + senha, sem e-mail nem confirmação),
guardada no SQLite, e entra no jogo de qualquer aparelho, a qualquer momento, sem precisar de convite
novo.

**Decisões do dono do projeto (já tomadas):**

| Pergunta | Decisão |
|---|---|
| Com o que o convidado entra? | **O nome que aparece na mesa + senha.** Por isso, o nome passa a ser único. |
| A senha é obrigatória no convite? | **Sim.** Quem aceita um convite novo escolhe o nome e a senha. |
| Esqueceu a senha? | **Link de retorno** (já existe em "Jogadores"): ao abri-lo, o jogador define uma senha nova. |

As senhas nunca podem ser lidas por ninguém, nem pelo dono: o banco guarda só o hash (scrypt +
pimenta, `BACKEND_SECURITY.md` §1).

**Fora do escopo:** e-mail para convidados; cadastro sem convite (continua não existindo); mudar a
conta do dono (continua entrando por e-mail, criada só pelo terminal).

## 2. Regras

1. **Nome de entrada.** O nome do convidado com senha é único entre os convidados com senha,
   comparado sem diferenciar maiúsculas, acentos e espaços repetidos ("Lyra", "lyra" e " Lýra "
   são o mesmo). Nomes de convidado não podem ter `@` (o `@` indica e-mail, o login do dono).
2. **Convite novo:** nome + senha (de 8 a 128 caracteres, sem as mais comuns, as regras de sempre).
   Nome já usado → 409 "Esse nome já está em uso. Escolha outro." O convite não é gasto.
3. **Link de retorno:** a pessoa vê o nome da conta (fixo) e define uma senha nova. Usar o link
   troca a senha, encerra as outras sessões da conta e abre uma sessão neste aparelho, tudo de uma
   vez. Serve tanto para quem esqueceu a senha quanto para o convidado antigo, sem senha, que perdeu
   o cookie. Se o nome da conta já estiver em uso por outro convidado com senha (só acontece com
   convidados antigos), o formulário pede também um nome novo.
4. **Convidado antigo (sem senha) ainda logado:** o menu da conta mostra "Criar senha". Um aviso em
   "Mesas online" lembra de criar a senha até ele criar. Se o nome atual já estiver em uso por outro
   convidado com senha, ele troca o nome primeiro (a tela explica).
5. **Entrar:** a página de entrada aceita "E-mail ou nome". Com `@` → conta do dono (como hoje);
   sem `@` → convidado com senha. Erro único "Nome, e-mail ou senha inválidos", com o mesmo tempo de
   resposta exista ou não a conta (`dummyVerify`), e o atraso crescente por login + IP de hoje.
6. **Sessão do convidado:** continua com 180 dias, sem cair por inatividade (a ideia é ficar
   conectado). Sair, "sair de todos os dispositivos" e excluir a conta funcionam como para o dono.
7. **Trocar a senha** (menu da conta): pede a senha atual (rota existente `/auth/password`).
8. **Trocar o nome** (convidado com senha): muda também o nome de entrada, com a mesma checagem de
   nome único.
9. **Excluir a conta:** convidado com senha confirma a senha (como o dono); sem senha, como hoje.
10. **Tirar da última mesa** continua encerrando as sessões do convidado. A conta e a senha continuam
    existindo: ele entra, mas não vê mesa nenhuma até receber outro convite.

## 3. Banco (migração 4)

```sql
ALTER TABLE users ADD COLUMN login_name TEXT;
CREATE UNIQUE INDEX users_login_name ON users(login_name) WHERE login_name IS NOT NULL;
```

- `login_name` = nome normalizado (regra 1), preenchido só para convidados com senha. O índice
  garante, no próprio banco, que não haverá dois iguais (duas pessoas criando o mesmo nome ao mesmo
  tempo: uma recebe o 409).
- `password_hash` do convidado passa de `NO_PASSWORD` a um hash real quando ele cria a senha.
- Convidados que já existem ficam com `login_name` NULL: nada muda para eles até criarem a senha.
- O dono não usa `login_name`.

## 4. Servidor

### Funções novas

- `lib/login-name.ts`: `loginNameOf(name)` (normaliza: NFKD sem acentos, minúsculas, espaços
  únicos, sem bordas) e a validação "sem `@`". Pura, com teste.
- `UsersRepository`: `createGuest(id, name, now, credentials?)` com `login_name` e hash;
  `credentialsByLoginName(login)`; `setGuestLogin(id, name, loginName, hash)`;
  `hasPassword(id)`. Conflito do índice único vira 409.
- `AuthService`:
  - `createGuest(name, password)`: valida a senha (`passwordProblem(password, name)`), calcula o
    hash **fora** da transação e cria a conta na transação do convite;
  - `login(login, password, ip)`: escolhe e-mail ou nome pela regra 5; o resto como hoje;
  - `setGuestPassword(userId, password)`: para "Criar senha" (só sem senha) e para o link de retorno
    (sempre); grava o hash e o `login_name`, encerra todas as sessões e devolve uma sessão nova;
  - `renameGuest` dentro do `PATCH /me` para convidados com senha.
- `PublicUser` ganha `hasPassword: boolean` (o front decide o que mostrar no menu da conta).

### Rotas

| Rota | Mudança |
|---|---|
| `POST /auth/login` | Corpo `{ login, password }` (era `email`). |
| `POST /invites/redeem` | Convite novo: `{ code, name, password }`, senha obrigatória. Link de retorno: `{ code, password, name? }`, define a senha nova (`name` só quando o nome atual já está em uso: 409 com esse motivo). |
| `POST /auth/password/create` | **Nova.** `{ password }`. Só convidado logado e sem senha. Rate limit de autenticação. |
| `PATCH /me` | Convidado com senha: renomear atualiza o `login_name` (409 se já usado). |
| `DELETE /me` | Convidado com senha confirma a senha. |

Todas com `strictObject` e limites (`BACKEND_SECURITY.md` §5). Eventos de `audit()`: `senha.criada`,
`senha.redefinida_por_link`, e os de login de sempre (com o `ref` do login, nunca o login em texto).

### Segurança

- A unicidade do nome revela que um nome existe. Isso é aceitável: os nomes já aparecem para os
  outros jogadores na mesa. A defesa contra adivinhar senhas é a de sempre: scrypt, atraso crescente
  por login + IP e por login, e o rate limit das rotas de autenticação.
- O link de retorno continua de uso único, com 7 dias, só o hash no banco, e só o mestre da mesa o
  gera. Quem tiver o link define a senha: é o mesmo poder que o link já dá hoje (entrar na conta).
- Hash calculado fora das transações; a corrida entre dois cadastros do mesmo nome é resolvida pelo
  índice único.

## 5. Front-end

- **Convite** (`features/auth/invite`): convite novo → nome, senha e "repita a senha". Link de
  retorno → nome da conta (fixo) + senha nova e confirmação, com o texto "Defina uma senha nova para
  entrar de qualquer aparelho".
- **Entrar** (`features/auth/sign-in`): campo "E-mail ou nome", com a dica "Jogadores: use o nome da
  mesa".
- **Mesas online** (`online-tables`): menu da conta com "Criar senha" (sem senha) ou "Trocar senha"
  (com senha); aviso para quem ainda não tem senha.
- `ServerAccountService`: `login(login, password)`, `createPassword`, `changePassword`.

## 6. Testes

- **Servidor (Vitest):** `loginNameOf`; convite novo com senha e nome repetido (409, convite não
  gasto); login por nome e por e-mail; mensagem e tempo iguais para nome inexistente e senha errada;
  atraso crescente por nome; link de retorno troca a senha e derruba as outras sessões; "Criar senha"
  só uma vez e só para convidado; renomear respeita o nome único; excluir conta pede a senha; o
  convidado antigo continua funcionando sem senha.
- **e2e** (`npm run e2e`): a amiga entra pelo convite com nome e senha; numa segunda janela, entra
  pela página de entrada com nome e senha; o link de retorno define uma senha nova.
- `npm run smoke` e `scripts/e2e.ts` passam a mandar `login` no lugar de `email`.

## 7. Documentação

CLAUDE.md §1 e §7 ("Contas"), `server/README.md` e `BACKEND_SECURITY.md` §1 (login do convidado)
são atualizados junto com o código.
