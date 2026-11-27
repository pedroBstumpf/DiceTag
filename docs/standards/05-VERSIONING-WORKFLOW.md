# 05 · Versionamento, GitHub e Organização de Tarefas

> Fluxo de trabalho de ponta a ponta: da ideia à produção. Amarra todos os padrões anteriores — cada etapa aponta para os checklists dos docs 01–04.
> Relacionados: [README](./README.md) · [Front](./01-FRONTEND.md) · [Back](./02-BACKEND.md) · [Banco](./03-DATABASE.md) · [Segurança/Testes](./04-SECURITY-TESTING-QA.md)

---

## Sumário

1. [Visão geral do fluxo](#1-visão-geral-do-fluxo)
2. [Organização de tarefas (GitHub Projects)](#2-organização-de-tarefas-github-projects)
3. [Issues: tipos, labels e templates](#3-issues-tipos-labels-e-templates)
4. [Estratégia de branches](#4-estratégia-de-branches)
5. [Commits (Conventional Commits)](#5-commits-conventional-commits)
6. [Pull Requests e code review](#6-pull-requests-e-code-review)
7. [CI/CD (GitHub Actions)](#7-cicd-github-actions)
8. [Versionamento semântico e releases](#8-versionamento-semântico-e-releases)
9. [Hotfix e rollback](#9-hotfix-e-rollback)
10. [Configuração do repositório](#10-configuração-do-repositório)
11. [Estrutura de arquivos `.github/`](#11-estrutura-de-arquivos-github)
12. [Monorepo vs multi-repo](#12-monorepo-vs-multi-repo)
13. [Resumo de uma página](#13-resumo-de-uma-página)

---

## 1. Visão geral do fluxo

```
 Ideia ─► Issue (Backlog) ─► Refinamento (DoR) ─► Ready ─► Branch ─► Commits
   ─► PR (Draft) ─► CI verde ─► Review ─► Squash merge na main ─► Deploy automático em staging
   ─► Validação ─► Release (tag vX.Y.Z) ─► Produção ─► Monitoramento ─► Issue fechada (DoD)
```

Modelo adotado: **GitHub Flow + Trunk-Based Development**
- `main` é sempre estável e implantável.
- Branches curtas (horas a ~3 dias), sempre a partir da `main` atualizada.
- Integração contínua frequente; trabalho incompleto protegido por feature flag (doc 04 §17).
- Releases são **tags** sobre a `main`, não branches de longa duração.

> Git Flow (develop/release branches) só se houver necessidade real de manter várias versões em paralelo (ex.: app instalado em clientes, SDK). Exige ADR.

---

## 2. Organização de tarefas (GitHub Projects)

### Hierarquia de trabalho

| Nível | O que é | Duração típica | No GitHub |
|-------|---------|----------------|-----------|
| **Épico** | Objetivo de negócio grande | Semanas | Issue tipo `Epic` com sub-issues |
| **História / Feature** | Entrega de valor ao usuário | 1–5 dias | Issue tipo `Feature` (sub-issue do épico) |
| **Tarefa** | Passo técnico de uma história | Horas–1 dia | Sub-issue ou checklist na issue |
| **Bug** | Comportamento incorreto | Variável | Issue tipo `Bug` |
| **Chore / Dívida** | Manutenção sem mudança visível | Variável | Issue tipo `Task` + label `type:chore`/`type:debt` |

Regra: **nenhum código sem issue** (exceto correções triviais de docs/typo).

### Quadro (Board) — colunas/status

| Status | Entra quando… | Sai quando… |
|--------|---------------|-------------|
| 📥 **Backlog** | Issue criada | Priorizada para refinamento |
| 🔍 **Refinamento** | Em discussão/especificação | Atende a **Definition of Ready** (doc 04 §18) |
| ✅ **Ready** | Pronta e priorizada | Alguém se atribui |
| 🛠️ **In Progress** | Branch criada, dev atribuído | PR aberto pronto para revisão |
| 👀 **In Review** | PR aguardando/em revisão | PR aprovado e mergeado |
| 🧪 **QA / Staging** | Em staging para validação | Validado conforme critérios de aceite |
| 🚀 **Done** | Em produção e atende **Definition of Done** | — |
| ⛔ **Blocked** (flag) | Impedimento externo | Impedimento resolvido (registrar o motivo em comentário) |

- **Limite de WIP:** no máximo 2 itens "In Progress" por pessoa. Termine antes de começar.
- Automatizar no Projects: PR aberto → In Review; PR mergeado → QA/Staging; issue fechada → Done.

### Campos customizados no Projects

| Campo | Valores |
|-------|---------|
| Prioridade | `P0 Crítico` · `P1 Alta` · `P2 Média` · `P3 Baixa` |
| Tamanho | `XS` (<2h) · `S` (½ dia) · `M` (1–2 dias) · `L` (3 dias) · `XL` (quebrar!) |
| Iteração | Sprints de 1 ou 2 semanas (campo *Iteration*) |
| Área | `front` · `back` · `db` · `infra` · `design` |
| Marco (Milestone) | Versão alvo (`v1.2.0`) ou objetivo (`MVP`) |

### Cadência sugerida (adaptar ao tamanho do time)

| Ritual | Frequência | Duração | Saída |
|--------|------------|---------|-------|
| Planning | Início da iteração | 30–60 min | Iteração preenchida com itens Ready |
| Daily (assíncrona ou síncrona) | Diária | ≤ 15 min | Bloqueios visíveis |
| Refinamento | Semanal | 30–60 min | Itens atendendo DoR |
| Review / Demo | Fim da iteração | 30 min | Feedback sobre o que foi entregue |
| Retrospectiva | Fim da iteração | 30 min | 1–3 ações de melhoria (viram issues) |

Para projetos solo: mantenha o board, a DoR/DoD e uma revisão semanal — os rituais viram um checklist pessoal.

---

## 3. Issues: tipos, labels e templates

### Labels padrão (criar em todo repositório)

| Grupo | Labels |
|-------|--------|
| Tipo | `type:feature` `type:bug` `type:chore` `type:docs` `type:refactor` `type:test` `type:debt` `type:security` `type:perf` |
| Área | `area:front` `area:back` `area:db` `area:infra` `area:design` `area:ci` |
| Prioridade | `priority:P0` `priority:P1` `priority:P2` `priority:P3` |
| Status especial | `status:blocked` `status:needs-info` `status:needs-design` |
| Outros | `breaking-change` `good-first-issue` `dependencies` `wontfix` `duplicate` |

> Se usar *Issue Types* nativos do GitHub, eles substituem o grupo "Tipo".

### Templates

Os templates de Feature, Bug e Task, e o `config.yml` (vulnerabilidades por canal privado), ficam em
`.github/ISSUE_TEMPLATE/` deste repositório.

---

## 4. Estratégia de branches

### Branches

| Branch | Propósito | Vida |
|--------|-----------|------|
| `main` | Código estável; fonte de todos os deploys | Permanente, protegida |
| `feat/<issue>-<descricao>` | Nova funcionalidade | Curta |
| `fix/<issue>-<descricao>` | Correção de bug | Curta |
| `hotfix/<issue>-<descricao>` | Correção urgente em produção | Curtíssima |
| `chore/…` `refactor/…` `docs/…` `test/…` `perf/…` `ci/…` | Demais tipos (mesmos do commit) | Curta |

**Formato:** `<tipo>/<nº-da-issue>-<descricao-em-kebab-case>` — minúsculas, sem acentos, ≤ 50 caracteres.

```bash
feat/142-filtro-pedidos-por-status
fix/198-erro-login-safari
chore/210-atualizar-angular-23
```

### Regras

- Sempre criar a partir da `main` atualizada: `git switch main && git pull --rebase && git switch -c feat/142-...`
- Manter a branch atualizada com **rebase** (`git pull --rebase origin main`), não merge da main na branch.
- `git push --force-with-lease` (nunca `--force`) somente na **sua** branch.
- Branch apagada automaticamente após o merge.
- Branches sem atividade há > 14 dias são revisadas e fechadas.

---

## 5. Commits (Conventional Commits)

### Formato

```
<tipo>(<escopo opcional>): <descrição no imperativo, minúscula, sem ponto>

<corpo opcional: o porquê da mudança, não o como>

<rodapé opcional: Closes #142 | BREAKING CHANGE: ... | Co-authored-by: ...>
```

### Tipos

| Tipo | Uso | Efeito na versão |
|------|-----|------------------|
| `feat` | Nova funcionalidade | MINOR |
| `fix` | Correção de bug | PATCH |
| `perf` | Melhoria de performance | PATCH |
| `refactor` | Mudança interna sem alterar comportamento | — |
| `docs` | Documentação | — |
| `style` | Formatação (sem mudar lógica) | — |
| `test` | Testes | — |
| `build` | Build, dependências | — |
| `ci` | Pipelines | — |
| `chore` | Manutenção geral | — |
| `revert` | Reverte commit anterior | depende |
| `!` ou `BREAKING CHANGE:` | Quebra de compatibilidade | MAJOR |

**Escopos sugeridos:** nome da feature (`orders`, `auth`), ou camada (`ui`, `api`, `db`, `deps`).

### Regras

- Commits **atômicos**: uma mudança lógica por commit; o projeto compila e os testes passam em cada um.
- Idioma: **definir um por projeto** (recomendado: tipo/escopo em inglês, descrição em pt-BR ou tudo em inglês) e manter consistente.
- Validação automática: `commitlint` + `husky` (hook `commit-msg`).
- Commits assinados (GPG/SSH) DEVERIAM ser exigidos na `main`.
- Nunca commitar: segredos, `.env`, builds (`dist/`), `node_modules/`, arquivos pessoais de IDE.

---

## 6. Pull Requests e code review

### Regras do PR

- **Pequeno:** ideal < 400 linhas alteradas (excluindo lockfiles/gerados). PR grande → quebrar em PRs empilhados ou usar feature flag.
- **Título** no formato de Conventional Commit (vira a mensagem do squash): `feat(orders): adicionar filtro por status`.
- Vincular a issue (`Closes #142`).
- Abrir como **Draft** cedo para feedback; marcar "Ready for review" quando CI estiver verde e a auto-revisão feita.
- O autor revisa o próprio diff antes de pedir revisão.
- **Merge:** somente **Squash and merge** (histórico linear: 1 PR = 1 commit na `main`).
- Quem abre o PR é responsável por mergear após aprovação e acompanhar o deploy.

O template fica em `.github/pull_request_template.md`.

### Code review

- **SLA:** primeira revisão em até 1 dia útil. Revisar tem prioridade sobre começar trabalho novo.
- Mínimo **1 aprovação** (2 para código sensível: auth, pagamento, infra, migrations destrutivas — garantido via CODEOWNERS).
- O revisor verifica, nesta ordem: **corretude → segurança → design/arquitetura → testes → legibilidade → estilo** (estilo é papel do linter, não do humano).
- Comentários com prefixos para deixar a intenção clara:

| Prefixo | Significado |
|---------|-------------|
| `bloqueante:` | Precisa mudar antes do merge |
| `sugestão:` | Melhoria recomendada, autor decide |
| `dúvida:` | Pergunta para entender |
| `nit:` | Detalhe menor, opcional |
| `elogio:` | Algo bem feito 👏 |

- Critique o código, não a pessoa. Explique o porquê e, se possível, sugira o código (`suggestion` do GitHub).
- Autor responde todos os comentários; quem abriu a conversa a resolve.
- Revisão assistida por IA é bem-vinda como **primeira passada**, nunca substitui a aprovação humana.

---

## 7. CI/CD (GitHub Actions)

### Pipeline de PR

Etapas: `format:check` → `lint` → `typecheck` → `test:ci` (cobertura) → `build` → `npm audit --audit-level=high` →
e2e. Actions fixadas por SHA (doc 04 §8), `permissions: contents: read`, `concurrency` com cancelamento.

Workflows complementares:
- `codeql.yml` — análise estática (PR + semanal).
- `commitlint.yml` — valida título do PR.
- `deploy-staging.yml` — em push na `main`: build → migrations → deploy → smoke test.
- `release.yml` — gera versão, CHANGELOG, tag e GitHub Release.
- `deploy-production.yml` — dispara na publicação da release; usa *Environment* `production` com aprovação obrigatória.

### Ambientes

| Ambiente | Gatilho | Aprovação | Dados |
|----------|---------|-----------|-------|
| Preview (por PR) | PR aberto (opcional; Vercel/Netlify/Firebase Hosting) | — | Fictícios |
| Staging | Merge na `main` | Automático | Fictícios/anonimizados |
| Produção | Release publicada | Manual (reviewers do Environment) | Reais |

O **mesmo artefato** construído uma vez é promovido entre ambientes; só a configuração muda.

---

## 8. Versionamento semântico e releases

- **SemVer** `MAJOR.MINOR.PATCH`:
  - MAJOR — quebra de compatibilidade (API pública, contrato, comportamento esperado).
  - MINOR — funcionalidade nova compatível.
  - PATCH — correções compatíveis.
  - Pré-release: `1.3.0-rc.1`, `2.0.0-beta.2`.
- Versão inicial de desenvolvimento: `0.x.y`; `1.0.0` no primeiro lançamento público.
- Versão calculada **automaticamente** a partir dos Conventional Commits com **release-please** (recomendado) ou **semantic-release**.
- **CHANGELOG.md** gerado automaticamente (formato Keep a Changelog); nunca editado à mão, exceto para notas de destaque.
- Tags `vX.Y.Z` anotadas e protegidas; GitHub Release com notas geradas.
- Cadência: release sempre que houver valor pronto (contínuo) ou cadência fixa (semanal/quinzenal) — escolher por projeto.
- A versão DEVE ser visível no app (rodapé/"Sobre") e enviada ao monitoramento de erros.

### Fluxo com release-please

```
commits na main ─► bot abre/atualiza PR "chore(main): release 1.4.0" com CHANGELOG
                └► ao mergear esse PR ─► tag v1.4.0 + GitHub Release ─► deploy em produção
```

---

## 9. Hotfix e rollback

### Hotfix (bug P0/P1 em produção)

1. Abrir issue com `priority:P0` e comunicar no canal do time.
2. Se a `main` estiver estável e pronta para produção: `hotfix/<issue>-...` a partir da `main` → PR com revisão acelerada (ainda com 1 aprovação e CI verde) → merge → release PATCH.
3. Se a `main` tiver mudanças não lançáveis: criar branch a partir da **tag em produção** (`git switch -c hotfix/... v1.4.0`), corrigir, gerar `v1.4.1` a partir dela, e **levar a correção para a `main`** (cherry-pick) imediatamente.
4. Teste que reproduz o bug é obrigatório, mesmo no hotfix.
5. Post-mortem sem culpados se for SEV1/SEV2 (doc 04 §16).

### Rollback

- Primeira opção: **desligar a feature flag**.
- Segunda: redeploy do artefato da versão anterior (pipeline com "deploy de tag específica").
- Código: `git revert` do commit de squash via PR (`revert: feat(orders): ...`) — nunca reescrever histórico da `main`.
- Banco: migrations compatíveis com a versão anterior tornam o rollback de código seguro sem rollback de schema (doc 03 §10).

---

## 10. Configuração do repositório

### Geral
- [ ] Nome em kebab-case; descrição e tópicos preenchidos; visibilidade correta (privado por padrão)
- [ ] Branch padrão `main`
- [ ] Merge: **somente squash** habilitado; título do squash = título do PR
- [ ] "Automatically delete head branches" ativado
- [ ] "Always suggest updating pull request branches" ativado
- [ ] Wiki desativada (docs ficam no repositório); Discussions opcional

### Ruleset / Branch protection da `main`
- [ ] Exigir PR antes do merge (sem push direto, inclusive para admins)
- [ ] Exigir 1+ aprovação; descartar aprovações quando houver novos commits
- [ ] Exigir revisão dos **CODEOWNERS**
- [ ] Exigir que todas as conversas estejam resolvidas
- [ ] Exigir status checks: `quality`, `e2e`, `CodeQL`, `commitlint`
- [ ] Exigir branch atualizada antes do merge
- [ ] Exigir histórico linear
- [ ] Exigir commits assinados (recomendado)
- [ ] Bloquear force push e deleção
- [ ] Ruleset para tags `v*`: só a automação de release pode criar

### Segurança (Settings › Advanced Security)
- [ ] Dependency graph + **Dependabot alerts** + **Dependabot security updates**
- [ ] **Secret scanning** + **Push protection**
- [ ] **Code scanning (CodeQL)**
- [ ] Private vulnerability reporting ativado
- [ ] Actions: permitir apenas actions verificadas/allowlist; `GITHUB_TOKEN` padrão somente leitura
- [ ] Environments `staging` e `production` com segredos próprios; `production` com reviewers obrigatórios

### Acesso
- [ ] Acesso por **times**, não por pessoas; menor privilégio (`Read`/`Triage`/`Write`/`Maintain`/`Admin`)
- [ ] MFA obrigatório na organização
- [ ] Revisão trimestral de acessos e de deploy keys/tokens

---

## 11. Estrutura de arquivos `.github/`

```
.github/
├── CODEOWNERS
├── dependabot.yml
├── pull_request_template.md
├── ISSUE_TEMPLATE/
│   ├── config.yml
│   ├── feature.yml
│   ├── bug.yml
│   └── task.yml
└── workflows/
    ├── ci.yml
    ├── codeql.yml
    ├── commitlint.yml
    ├── deploy-staging.yml
    ├── release.yml
    └── deploy-production.yml

# Na raiz do repositório
README.md            # o que é, como rodar, como contribuir, links para docs/
CONTRIBUTING.md      # resumo deste documento + setup local
SECURITY.md          # como reportar vulnerabilidades, versões suportadas
CHANGELOG.md         # gerado automaticamente
LICENSE
.editorconfig  .nvmrc  .gitignore  .env.example
```

---

## 12. Monorepo vs multi-repo

| | Monorepo (Nx/Turborepo + npm workspaces) | Multi-repo |
|--|------------------------------------------|------------|
| Quando | Front + back em TypeScript, tipos/contratos compartilhados, time único | Times/stacks independentes, ciclos de release distintos |
| Prós | Mudança atômica front+back, tipos compartilhados, uma config de CI | Isolamento, permissões e pipelines simples por repo |
| Contras | Exige ferramenta de build afetado (cache, `nx affected`) | Sincronizar contratos (publicar pacote de tipos/OpenAPI) |

Decisão registrada em ADR.

---

## 13. Resumo de uma página

| Etapa | Regra | Referência |
|-------|-------|------------|
| Tarefa | Toda mudança nasce de uma issue com critérios de aceite e DoR | §2–3, doc 04 §18 |
| Branch | `tipo/nº-descricao`, a partir da `main`, vida curta, rebase | §4 |
| Commit | Conventional Commits, atômico, validado por commitlint | §5 |
| Código | Seguir docs 01 (front), 02 (back), 03 (banco) | — |
| Segurança | Nada de segredos; autorização no back; checklists do doc 04 | doc 04 |
| Testes | Pirâmide; bug ⇒ teste; gates verdes | doc 04 §10–15 |
| PR | Pequeno, template preenchido, 1–2 aprovações, conversas resolvidas | §6 |
| Merge | Squash na `main` protegida | §6, §10 |
| Deploy | `main` → staging automático; release → produção com aprovação | §7 |
| Versão | SemVer automático, CHANGELOG gerado, tag `vX.Y.Z` | §8 |
| Produção | Monitorar, flag para desligar, rollback em minutos | §9, doc 04 §16–17 |
| Fechamento | Issue fechada só quando atende a Definition of Done | doc 04 §18 |
