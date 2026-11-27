# Auditoria do Game Master's Dream (DiceTag) contra os padrões base

- **Data:** 2026-11-27
- **Base:** `main` em `b79d71b` (versão 0.6.0)
- **Padrões:** `docs/standards/` v1.0.0 (README, 01-FRONTEND, 02-BACKEND, 03-DATABASE, 04-SECURITY-TESTING-QA, 05-VERSIONING-WORKFLOW)
- **Linha de base medida:** `npm run build` ✅ · `ng test` ✅ 40 arquivos / 339 testes · `server: npm run check` ✅ 10 arquivos / 275 testes · `npm audit` do servidor: 2 moderadas (dev, `@vitest/mocker`), 0 altas

Legenda: ✅ atende · ⚠️ atende em parte · ❌ não atende · 🔀 divergência intencional (ver ADR).
Nível: **DEVE** / **DEVERIA** / **PODE** (RFC 2119, como nos padrões). Esforço: P (< 2h) · M (½–1 dia) · G (> 1 dia).

---

## Resumo

O projeto já está **acima da média** em segurança e disciplina de código: TypeScript strict, OnPush em 100% dos
componentes, zero `any`/`innerHTML`/`bypassSecurityTrust`/`console.log`, camadas verificadas no build, servidor com
validação `strictObject`, autorização por recurso no SQL, cookie `__Host-` HttpOnly/SameSite=Strict, CSRF por origem,
rate limit, auditoria, servidor isolado com `--permission` do Node e backup cifrado testável.

As lacunas estão concentradas em **processo e automação** (doc 05 e 04 §15): faltam lint, hooks, templates do GitHub,
CODEOWNERS, Dependabot, CodeQL, actions fixadas por SHA, cobertura no CI e releases automáticas. No código, os maiores
itens são o **upgrade Angular 22 / TypeScript 6**, os **aliases de import**, a **página 404** e o **formato de erro
RFC 9457**.

Divergências de stack que fazem sentido para este app (mesa caseira no Windows, um único dono) foram registradas como
ADRs em vez de "corrigidas": hospedagem Windows + Tailscale Funnel, Fastify, SQLite, autenticação própria, Angular
Material e CI no Windows.

---|---|---|---|---|
| 01 Front-end | 14 | 6 | 7 | 1 |
| 02 Back-end | 13 | 4 | 3 | 2 |
| 03 Banco | 6 | 3 | 1 | 1 |
| 04 Segurança/Testes/QA | 15 | 6 | 8 | 1 |
| 05 Versionamento/GitHub | 4 | 3 | 14 | 1 |

---

## 01 · Front-end

| # | Regra | Nível | Situação | Evidência / ação | Esforço |
|---|---|---|---|---|---|
| F1 | Angular 22+, TS 6 | DEVE (stack de referência) | ❌ | Angular 21.2, TS 5.9. `ng update` para 22 com testes reforçados antes | G |
| F2 | `strict`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noPropertyAccessFromIndexSignature` | DEVE | ✅ | `tsconfig.json` | — |
| F3 | `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `forceConsistentCasingInFileNames` | DEVE | ❌ | Ausentes. Ligar um por vez; o primeiro deve gerar centenas de erros (mapa, geometria) | G |
| F4 | `extendedDiagnostics` como erro | DEVE | ❌ | Ausente | P |
| F5 | Aliases `@core/@shared/@features`, sem `../../../` | DEVE | ❌ | 243 imports com `../../../`. Codemod + regra no `check-deps.mjs` | M |
| F6 | Budgets 400kB/600kB | DEVE | 🔀 | 850kB/1.5MB; inicial real ~676kB (Material + Tiptap + mapa). Ver ADR-0005; meta: reduzir aviso para 750kB | — |
| F7 | Zoneless, standalone, OnPush, `inject()`, `input()/output()` | DEVE | ✅ | Sem zone.js; 0 `@Input`/`@Output`, 0 `ngClass`/`ngStyle`, 0 `@HostListener` | — |
| F8 | Control flow nativo com `track` | DEVE | ✅ | Convenção do `CLAUDE.md` §5 | — |
| F9 | Regras de camadas verificadas automaticamente | DEVERIA | ✅ | `scripts/check-deps.mjs` no `prebuild` | — |
| F10 | Estrutura `data-access/feature/ui` por feature | DEVERIA | ⚠️ | Features usam `services/`, `components/`, `state/`, `utils/`. Equivalente; não migrar sem motivo | — |
| F11 | `HttpClient` só em classes `*Api` | DEVE | ✅ | Tudo via `ServerApiService` (usa `fetch`, centralizado) | — |
| F12 | Tipos gerados do OpenAPI | DEVERIA | ❌ | Tipos escritos à mão dos dois lados. Depende de B6 | G |
| F13 | Interceptors de erro/401 | DEVE | ⚠️ | Tratamento central em `ServerApiService` (`ServerError`, `SERVER_OFFLINE`) — equivalente sem `HttpClient` | — |
| F14 | `GlobalErrorHandler` + monitoramento sem PII | DEVE | ❌ | Só `provideBrowserGlobalErrorListeners()`. App caseiro: um handler que grava no log do servidor basta (sem Sentry) | M |
| F15 | Formulários: Signal Forms (novo) / Reactive tipado | DEVERIA | ✅ | Reactive em 3 arquivos, sem `ngModel` | — |
| F16 | Rotas lazy, guards funcionais, títulos | DEVE | ✅ | `app.routes.ts` | — |
| F17 | Rota `**` com página 404 | DEVE | ❌ | `**` redireciona para `''`. Criar `NotFound` | P |
| F18 | Tokens semânticos no `@theme`, sem valores arbitrários | DEVE | ✅ | `src/styles/tailwind.css`; conferir arbitrários com o lint | — |
| F19 | `prettier-plugin-tailwindcss` | DEVE | ❌ | Sem plugin. Reordena classes em todos os templates: PR próprio, só formatação | M |
| F20 | Uma biblioteca de UI completa, em ADR | DEVE | 🔀→✅ | Angular Material + CDK (diretriz do dono). ADR-0005 | — |
| F21 | WCAG 2.2 AA, foco visível, `aria-live` | DEVE | ⚠️ | Foco visível e `prefers-contrast` existem; falta verificação automática (axe) | M |
| F22 | `NgOptimizedImage` em todas as imagens | DEVE | ⚠️ | 0 usos. Imagens do mapa são `blob:` (não se aplica); aplicar em logo/emblema | P |
| F23 | i18n preparada | DEVE | ❌ | Textos fixos em pt-BR. Projeto pessoal só em pt-BR: registrar exceção ou adotar `@angular/localize` | — (decisão) |
| F24 | `console.log` proibido | DEVE | ✅ | 0 ocorrências | — |
| F25 | Dados sensíveis fora do `localStorage` | DEVE | ⚠️ | Sessão da **conta local provisória** (`dicetag.session`) é só o id; a conta do servidor usa cookie HttpOnly. Resolver junto com a pendência "contas locais" (SPEC §6) | M |
| F26 | Lint (`angular-eslint` + `typescript-eslint` strict) | DEVE | ❌ | Sem ESLint | M |
| F27 | `husky` + `lint-staged` | DEVE | ❌ | Ausentes | P |
| F28 | Scripts `lint`, `format:check`, `typecheck`, `test:ci`, `e2e`, `audit` | DEVE | ❌ | Só `build`/`test` no front | P |
| F29 | `.editorconfig`, `.nvmrc` na raiz | DEVE | ⚠️ | `.editorconfig` ✅; `.nvmrc` só em `server/` | P |
| F30 | Versão visível no app | DEVE (doc 05 §8) | ❌ | Não aparece na interface | P |

## 02 · Back-end

| # | Regra | Nível | Situação | Evidência / ação | Esforço |
|---|---|---|---|---|---|
| B1 | Monólito modular, domínio sem framework | DEVE | ✅ | `server/src/domain` reaproveita as regras puras do front | — |
| B2 | NestJS nos exemplos | PODE | 🔀 | Fastify 5 + zod. ADR-0002 | — |
| B3 | Validação de toda entrada, whitelist, limites | DEVE | ✅ | `strictObject` + limites em todas as rotas e comandos; `safe-json` | — |
| B4 | Erros RFC 9457 (`application/problem+json`) | DEVE | ❌ | `{ error, details?, requestId? }`. Migrar mantendo `error` por compatibilidade com o front | M |
| B5 | 5xx sem detalhes internos, com id de correlação | DEVE | ✅ | `requestId`, pilha só no log | — |
| B6 | OpenAPI 3.1 versionado | DEVE | ❌ | Ausente | G |
| B7 | Rotas `/v1` | DEVE | ❌ | `/api/...` sem versão. Front e back sempre publicados juntos (mesmo repo): registrar exceção em ADR-0002 | — (decisão) |
| B8 | Negar por padrão, autorização por função **e** recurso | DEVE | ✅ | Só `config: PUBLIC` abre; participação no SQL; 404 para mesa alheia | — |
| B9 | Autenticação por provedor OIDC | DEVE | 🔀 | Autenticação própria (scrypt + pimenta, cookie). ADR-0004 | — |
| B10 | Senhas: argon2id/bcrypt, ≥ 12 caracteres, checar vazadas | DEVE | ⚠️ | scrypt (aceitável pela OWASP), mínimo **8**, bloqueia as mais comuns. Ver ADR-0004 | P |
| B11 | MFA obrigatório para administradores | DEVE (doc 04 §4) | ❌ | O dono (Mestre) não tem MFA. Proposta: TOTP opcional → obrigatório com o túnel aberto | G |
| B12 | Rate limit por IP e por conta no login | DEVE | ✅ | `login-throttle.ts` + `AUTH_RATE_LIMIT` | — |
| B13 | Config validada no boot, `.env.example` | DEVE | ✅ | `config/env.ts` (zod) | — |
| B14 | Logs JSON sem PII, auditoria separada | DEVE | ⚠️ | pino + `audit()` em login, senha, convites, permissão e limites; **falha de login não gera evento** (só cai no limite) | P |
| B15 | Health `live` / `ready` | DEVE | ⚠️ | Só `/api/health`. Acrescentar `ready` com checagem do banco | P |
| B16 | Timeouts, graceful shutdown | DEVE | ✅ | `main.ts` (SIGINT/SIGTERM grava as mesas e fecha o banco); e-mail com `AbortSignal.timeout` | — |
| B17 | Uploads: tipo por magic bytes, nome gerado, cotas | DEVE | ✅ | `file-type.ts`, cotas por conta, EXIF removido no front | — |
| B18 | Paginação com limite máximo | DEVE | ⚠️ | Listas pequenas por natureza (mesas, membros); itens do mundo vêm inteiros. Aceitável com limites de bytes; documentar | — |
| B19 | Containerização | PODE | — | Não se aplica (roda direto no Windows; ADR-0001) | — |
| B20 | Testes de integração com banco real | DEVE | ✅ | SQLite real em arquivo temporário nos testes | — |
| B21 | Testes 400/401/403/404 por endpoint | DEVE | ✅ | `security.test.ts`, `http.test.ts` | — |

## 03 · Banco de dados

| # | Regra | Nível | Situação | Evidência / ação | Esforço |
|---|---|---|---|---|---|
| D1 | PostgreSQL | DEVERIA | 🔀 | SQLite embutido (um processo, uma máquina). ADR-0003 | — |
| D2 | Migrations versionadas e imutáveis | DEVE | ✅ | `db/migrations.ts`, backup antes de migrar | — |
| D3 | Rollback (`down`) ou plano de reversão | DEVE | ⚠️ | Sem `down`; o plano é o backup automático antes de migrar. Documentar no runbook | P |
| D4 | Nomenclatura (`snake_case`, plural, `fk_`/`idx_`) | DEVE | ⚠️ | Tabelas e colunas ✅; índices `game_tables_world` (sem prefixo `idx_`). Não renomear (migração sem ganho); seguir em índices novos | — |
| D5 | Queries parametrizadas, sem `SELECT *` | DEVE | ⚠️ | 100% parametrizadas ✅; há `SELECT t.*` em `repositories/tables.ts` | P |
| D6 | FKs com `ON DELETE` explícito e índice | DEVE | ✅ | `CASCADE`/`RESTRICT` explícitos, índices nas FKs | — |
| D7 | Colunas de auditoria `created_at`/`updated_at` | DEVE | ⚠️ | `created_at` em todas; `updated_at` só onde há edição (`table_states`, `world_items`); `game_tables` não tem | P |
| D8 | IDs públicos não sequenciais | DEVE | ✅ | `newId()` aleatório | — |
| D9 | Backup 3-2-1, cifrado, restauração testada | DEVE | ✅ | Local + Google Drive cifrado (AES-256-GCM) + `npm run restaurar` | — |
| D10 | LGPD: exportar e excluir dados do titular | DEVE | ✅ | `/me/export`, `DELETE /me` | — |
| D11 | Retenção com expurgo automático | DEVE | ⚠️ | Sessões e links de senha vencidos são expurgados ✅; convites vencidos/usados ficam no banco; retenção de logs não definida | P |

## 04 · Segurança, testes e QA

| # | Regra | Nível | Situação | Evidência / ação | Esforço |
|---|---|---|---|---|---|
| S1 | Modelo de ameaças (STRIDE) | DEVE | ⚠️ | `BACKEND_SECURITY.md` cobre controles; falta o modelo explícito da exposição pela internet. Feito em ADR-0001 | — |
| S2 | Angular sem `bypassSecurityTrust`/`innerHTML` | DEVE | ✅ | 0 ocorrências; Tiptap sanitiza | — |
| S3 | CSP do front sem `unsafe-inline`, Trusted Types | DEVE | ⚠️ | CSP própria em `routes/frontend.ts`: `script-src 'self'` ✅, mas `style-src 'unsafe-inline'` (Material/estilos dinâmicos) e sem `require-trusted-types-for`. Fontes vêm do Google Fonts (terceiro): servir localmente | M |
| S4 | Headers (HSTS, nosniff, frame-ancestors, Referrer) | DEVE | ✅ | helmet; HSTS em produção | — |
| S5 | CORS por allowlist | DEVE | ✅ | `ALLOWED_ORIGINS` + `*.ts.net` só via host-control | — |
| S6 | Cookie de sessão `__Host-` HttpOnly Secure SameSite | DEVE | ✅ | `security/cookie.ts` | — |
| S7 | Convites/links de uso único, alta entropia, hash | DEVE | ✅ | 192 bits, hash, 7 dias (convite) / 30 min (senha) | — |
| S8 | Lockfiles commitados, `npm ci` | DEVE | ✅ | Dois lockfiles, CI com `npm ci` | — |
| S9 | `npm audit --audit-level=high` no CI | DEVE | ⚠️ | Só no servidor; falta no front | P |
| S10 | Dependabot | DEVE | ❌ | Ausente | P |
| S11 | SBOM por release, licenças | DEVERIA | ❌ | Ausente | P |
| S12 | Secret scanning + push protection + gitleaks | DEVE | ❌ | Ativar no GitHub; `gitleaks` no CI | P |
| S13 | `.gitignore` com `.env*`, `*.pem`, `*.key`, `*.p12` | DEVE | ⚠️ | `.env*` ✅; faltam `*.pem`, `*.key`, `*.p12` | P |
| S14 | Actions com `permissions` mínimas | DEVE | ✅ | `contents: read` | — |
| S15 | Actions fixadas por SHA | DEVE | ❌ | `@v4` por tag | P |
| S16 | CodeQL (SAST) | DEVE | ❌ | Ausente | P |
| S17 | DAST (ZAP baseline) a cada release | DEVE | ❌ | Ausente; rodar contra a mesa local antes de abrir o túnel | M |
| S18 | Testes unitários do domínio | DEVE | ✅ | `utils/` e `state/` com specs; 614 testes no total | — |
| S19 | Testes de componente (Testing Library) | DEVERIA | ❌ | Nenhum (`CLAUDE.md` §10) | G |
| S20 | E2E Playwright + axe | DEVE | ⚠️ | E2E próprio com dois navegadores (`npm run e2e`), fora do CI, sem axe | M |
| S21 | Cobertura ≥ 80% (domínio ≥ 90%), não pode cair | DEVE | ❌ | Não medida | P (medir) |
| S22 | Gates: format, lint, typecheck, test, build, e2e, audit, CodeQL, secrets | DEVE | ⚠️ | build + test + typecheck/audit (servidor) | M |
| S23 | Observabilidade: alertas, SLO | DEVE | 🔀 | Mesa caseira, liga quando joga: logs + auditoria bastam. ADR-0001 | — |
| S24 | Rollback em minutos | DEVE | ✅ | Backup antes de migrar + `npm run restaurar`; voltar à tag anterior | — |
| S25 | Feature flags | DEVERIA | ⚠️ | `app-settings.ts` (`requireAuth`); suficiente | — |
| S26 | Go-live: securityheaders nota A | DEVE | ⚠️ | Conferir com o túnel aberto (runbook) | P |

## 05 · Versionamento e GitHub

| # | Regra | Nível | Situação | Evidência / ação | Esforço |
|---|---|---|---|---|---|
| V1 | GitHub Flow, `main` estável | DEVE | ✅ | Trabalho em branches, `main` verde | — |
| V2 | Branches `tipo/nº-descricao`, vida curta, apagadas após merge | DEVE | ❌ | 12 branches remotas; `etapa-2..5`, `Tests` e `feat/*` antigas sem número de issue | P |
| V3 | Conventional Commits | DEVE | ✅ | Histórico em pt-BR no formato | — |
| V4 | `commitlint` + `husky` | DEVE | ❌ | Ausentes | P |
| V5 | Squash merge (1 PR = 1 commit) | DEVE | 🔀→❌ | Histórico usa merge commits (`merge: …`). Trocar para squash daqui em diante | P (config) |
| V6 | Nenhum código sem issue; Projects com quadro | DEVE | ❌ | Sem issues/quadro. Backlog desta auditoria vira issues (`scripts/github-setup.sh`) | P |
| V7 | Labels padrão | DEVE | ❌ | Criar via script | P |
| V8 | Templates de issue e PR | DEVE | ❌ | Ausentes | P |
| V9 | CODEOWNERS | DEVE | ❌ | Ausente | P |
| V10 | Branch protection / ruleset da `main` | DEVE | ❌ | Configurar (script + checklist) | P |
| V11 | Workflows `ci`, `codeql`, `commitlint` | DEVE | ⚠️ | Só `verificacao.yml` | M |
| V12 | Deploy staging/produção com Environments | DEVE | 🔀 | Não há servidor hospedado: "produção" é o `npm run mesa` na máquina do dono. ADR-0001 | — |
| V13 | SemVer automático (release-please), CHANGELOG gerado, tags | DEVE | ⚠️ | SemVer e 13 tags ✅; CHANGELOG manual | P |
| V14 | `SECURITY.md`, `CONTRIBUTING.md`, `LICENSE` | DEVE | ❌ | Ausentes (repositório **público**) | P |
| V15 | Docs em `docs/standards`, `docs/adr`, `docs/runbooks` | DEVE | ⚠️ | `docs/` existe sem essas pastas; `server/OPERATIONS.md` é um runbook | P |
| V16 | Secret scanning, Dependabot alerts, private vulnerability reporting | DEVE | ❌ | Configuração do GitHub | P |
| V17 | MFA na conta do GitHub | DEVE | ? | Conferir na conta | P |

---

## Plano de PRs (ordem de risco)

| PR | Branch | Itens | Risco |
|---|---|---|---|
| 1 | `docs/auditoria-padroes` | Esta auditoria, `docs/standards/`, ADRs 0001–0007, runbook da mesa | Nenhum (só docs) |
| 2 | `chore/configuracao-github` | V6–V10, V14, V16, S10, S12, S13, S15, S16, script `github-setup.sh` | Baixo |
| 3 | `chore/lint-e-hooks` | F4, F26–F29, V4, S9, S21, S22 (lint, format, husky, commitlint, cobertura, gates no CI) | Baixo |
| 4 | `feat/painel-do-mestre` | ADR-0007: tela única do Mestre (convidar, criar, ver e editar mesas) | Médio |
| 5+ | backlog (issues) | F1, F3, F5, F14, F17, F19, F30, B4, B6, B11, B15, D5, D7, D11, S17, S19, S20 | — |

O backlog está em `scripts/github-setup.sh` (PR 2) como issues prontas para criar com `gh`.
