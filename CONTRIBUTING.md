# Como contribuir

Resumo do fluxo de [`docs/standards/05-VERSIONING-WORKFLOW.md`](docs/standards/05-VERSIONING-WORKFLOW.md).
Contexto técnico do projeto: [`CLAUDE.md`](CLAUDE.md) e [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Setup local

```bash
npm ci                       # raiz (front-end)
cd server && npm ci && npm run setup   # servidor: .env com segredos aleatórios (nunca versionar)
```

Node: versão em `.nvmrc` (raiz e `server/`).

## Fluxo

1. **Issue primeiro** (templates em `.github/ISSUE_TEMPLATE/`), com critérios de aceite.
2. **Branch** a partir da `main` atualizada: `<tipo>/<nº-da-issue>-<descricao>` — ex.: `feat/42-portas-trancadas`.
3. **Commits** no Conventional Commits, descrição em pt-BR minúscula: `feat(mesa): adicionar portas trancadas`.
   Atualize a branch com `git pull --rebase origin main`.
4. **PR** pequeno (< 400 linhas), título no mesmo formato (vira o commit do squash), `Closes #42`, template preenchido.
5. **Gates verdes** antes do merge: Verificação (front e servidor), CodeQL, Segredos e Título do PR.
6. **Squash and merge.** A branch é apagada automaticamente.

## Antes de pedir revisão

```bash
npm run build && npx ng test --watch=false     # raiz
cd server && npm run check                     # tipos, testes e audit
```

Mudou comandos da mesa, permissões ou visibilidade? Siga a seção "Front ↔ servidor" do `CLAUDE.md` §5.
Mudou algo em `server/`? Siga o [`BACKEND_SECURITY.md`](BACKEND_SECURITY.md).
