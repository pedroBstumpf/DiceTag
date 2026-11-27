# 📘 Padrões Base — Projetos Angular + Tailwind

> Conjunto de documentos-padrão para iniciar **qualquer** aplicação Angular + Tailwind CSS (SPA, SSR, PWA, dashboard, e-commerce, SaaS, app interno) com qualidade profissional, segurança e organização desde o dia 1.

**Versão do padrão:** 1.0.0 · **Última revisão:** 2026-11
**Stack de referência:** Angular 22+ (standalone, signals, zoneless) · Tailwind CSS v4 · TypeScript 6 (strict) · Node 22 LTS+ · Vitest · Playwright

> **Neste repositório:** cópia versionada dos padrões v1.0.0 (fonte da verdade: projeto "dream program planning").
> As regras estão integrais; exemplos de código longos foram enxugados e os templates do doc 05 vivem em
> [`../../.github/`](../../.github/). Divergências do Game Master's Dream estão em [`../adr/`](../adr/) e o estado
> atual em [`../audit/`](../audit/).

---

## 🗂️ Documentos

| # | Arquivo | Conteúdo | Quem lê |
|---|---------|----------|---------|
| 0 | `README.md` | Este índice, princípios e como adotar | Todos |
| 1 | [`01-FRONTEND.md`](./01-FRONTEND.md) | Arquitetura, estrutura de pastas, Angular, Tailwind, estado, performance, a11y | Front |
| 2 | [`02-BACKEND.md`](./02-BACKEND.md) | Arquitetura de API, camadas, contratos, erros, logs, autenticação | Back / Full-stack |
| 3 | [`03-DATABASE.md`](./03-DATABASE.md) | Modelagem, nomenclatura, migrations, índices, performance, backup, LGPD | Back / DBA |
| 4 | [`04-SECURITY-TESTING-QA.md`](./04-SECURITY-TESTING-QA.md) | Segurança (OWASP), testes, checklists, observabilidade e cuidados gerais | Todos |
| 5 | [`05-VERSIONING-WORKFLOW.md`](./05-VERSIONING-WORKFLOW.md) | Git, GitHub, branches, commits, PRs, CI/CD, releases e gestão de tarefas | Todos |

**Ordem de leitura sugerida para quem chega:** README → 05 → 01 ou 02 → 04 → 03.

---

## 🧭 Princípios que regem todos os documentos

1. **Segurança por padrão** — o caminho mais fácil deve ser o seguro. Nada de "depois a gente protege".
2. **Simplicidade antes de abstração** — KISS e YAGNI. Abstraia na terceira repetição, não na primeira.
3. **Tipagem forte de ponta a ponta** — `strict: true`, sem `any`, contratos compartilhados ou gerados.
4. **Automatize o que pode ser verificado** — lint, formatação, testes, auditoria de dependências e build rodam no CI, nunca dependem de memória humana.
5. **Pequeno e frequente** — PRs pequenos, deploys frequentes, feedback rápido.
6. **Observável** — se não é medido/logado, não dá pra saber se funciona em produção.
7. **Acessível e performático** — WCAG 2.2 AA e Core Web Vitals são requisitos, não "nice to have".
8. **Documentado onde vive** — decisões em ADRs, contratos em OpenAPI, como rodar no README do projeto.
9. **Privacidade (LGPD/GDPR)** — colete o mínimo, proteja o que coletou, apague o que não precisa.
10. **Reversível** — toda mudança (código, migration, feature) deve ter caminho de volta.

---

## 🔤 Convenções usadas nestes documentos

Seguem a [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119):

- **DEVE / NÃO DEVE** → regra obrigatória. Violação bloqueia PR.
- **DEVERIA / NÃO DEVERIA** → recomendação forte. Exceção precisa de justificativa no PR.
- **PODE** → opcional, a critério do time.

---

## 🚀 Como adotar em um projeto novo

1. Copie esta pasta para `docs/standards/` do novo repositório.
2. Crie o projeto e aplique o setup descrito em `01-FRONTEND.md › Setup inicial`.
3. Configure o repositório no GitHub conforme `05-VERSIONING-WORKFLOW.md › Configuração do repositório` (branch protection, templates, CODEOWNERS, Dependabot, CodeQL).
4. Copie os templates de issue/PR de `05-VERSIONING-WORKFLOW.md` para `.github/`.
5. Preencha a seção **"Decisões do projeto"** abaixo (fica no README do projeto real).
6. Rode o checklist de **Definition of Ready do projeto** (`04-SECURITY-TESTING-QA.md`).

### Decisões do projeto (preencher por projeto)

```md
| Item                  | Escolha            | ADR       |
|-----------------------|--------------------|-----------|
| Renderização          | CSR / SSR / SSG    | ADR-0001  |
| Backend               | NestJS / .NET / ...| ADR-0002  |
| Banco de dados        | PostgreSQL / ...   | ADR-0003  |
| Autenticação          | OIDC (Keycloak/Auth0/Cognito/...) | ADR-0004 |
| Hospedagem            | ...                | ADR-0005  |
| Gerenciamento estado  | Signals + services / NgRx SignalStore | ADR-0006 |
| Biblioteca de UI      | Própria / Angular Aria / CDK / Spartan | ADR-0007 |
```

---

## 🧱 Estrutura de documentação recomendada no repositório

```
docs/
├── standards/          # estes arquivos (copiados e versionados)
├── adr/                # Architecture Decision Records (0001-titulo.md)
├── api/                # openapi.yaml, exemplos
├── runbooks/           # como operar: deploy, rollback, incidentes
└── onboarding.md       # primeiro dia no projeto
```

### Template de ADR (`docs/adr/0000-template.md`)

```md
# ADR-NNNN: Título curto da decisão

- **Status:** Proposto | Aceito | Substituído por ADR-XXXX | Obsoleto
- **Data:** AAAA-MM-DD
- **Decisores:** @fulano, @ciclano

## Contexto
Qual problema ou força motivou a decisão?

## Opções consideradas
1. Opção A — prós / contras
2. Opção B — prós / contras

## Decisão
O que foi escolhido e por quê.

## Consequências
O que fica mais fácil, o que fica mais difícil, riscos e como mitigar.
```

---

## ♻️ Manutenção deste padrão

- Revisar **a cada major do Angular** (a cada ~6 meses) e a cada novo OWASP Top 10.
- Mudanças no padrão seguem o mesmo fluxo de PR descrito em `05-VERSIONING-WORKFLOW.md`, com label `type:docs` e `scope:standards`.
- Versione este padrão com SemVer: mudança de regra obrigatória = MAJOR; nova recomendação = MINOR; correções = PATCH.
