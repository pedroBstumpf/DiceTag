# 04 · Segurança, Testes e Cuidados Gerais

> Verificações de segurança, estratégia de testes, qualidade, observabilidade e checklists de ciclo de vida. Baseado em **OWASP Top 10**, **OWASP API Security Top 10**, **OWASP ASVS** e DevSecOps.
> Relacionados: [Front-end](./01-FRONTEND.md) · [Back-end](./02-BACKEND.md) · [Banco](./03-DATABASE.md) · [Versionamento](./05-VERSIONING-WORKFLOW.md)

---

# Parte A — Segurança

## 1. Mentalidade e modelo de ameaças

- **Nunca confie no cliente**; **defesa em profundidade**; **menor privilégio**; **falhar fechado**.
- **Modelagem de ameaças (STRIDE)** em toda feature que mexe com autenticação, pagamento, dados pessoais, upload ou
  integrações. Resultado anexado à issue/ADR.

## 2. Segurança no Angular (front)

- NUNCA `bypassSecurityTrust*` com dados de usuário/API; se inevitável, DOMPurify num serviço único revisado.
- NUNCA manipular o DOM diretamente nem montar templates a partir de strings do usuário.
- Habilitar **Trusted Types** (`require-trusted-types-for 'script'`).
- `target="_blank"` DEVE ter `rel="noopener noreferrer"`; `returnUrl` validado por allowlist.
- `environment.ts` é público: nada de segredos; chaves públicas restritas por domínio.
- Não armazenar dados sensíveis em `localStorage`/`sessionStorage`/IndexedDB; limpar no logout.
- Nada sensível em URL. Source maps NÃO DEVEM ser públicos em produção.
- XSRF com cookie: `withXsrfConfiguration` + `SameSite` + validação no servidor.
- Scripts de CDN com **SRI** (ou no próprio bundle). Editores ricos configurados para sanitizar.

## 3. Cabeçalhos HTTP e CSP

No servidor do front **e** na API: CSP com `default-src 'self'`, nonce para script/style, `frame-ancestors 'none'`,
`base-uri 'self'`, `form-action 'self'`, `object-src 'none'`, Trusted Types; HSTS (2 anos, preload); `nosniff`;
`Referrer-Policy: strict-origin-when-cross-origin`; `Permissions-Policy` restritiva; COOP/CORP `same-origin`.

- CSP começa em Report-Only; evitar `'unsafe-inline'`/`'unsafe-eval'`.
- **CORS** por allowlist (nunca `*` com credenciais).
- `Cache-Control: no-store` em respostas autenticadas; assets com hash `immutable`.
- Verificar com securityheaders.com e Mozilla Observatory antes do go-live.

## 4. Autenticação, sessão e tokens no SPA

1. **BFF + cookie** `HttpOnly; Secure; SameSite; Path=/` com prefixo `__Host-` ✅ recomendado.
2. OIDC Code + PKCE, access token curto em memória, refresh rotativo.
3. ❌ Proibido: Implicit flow, token em `localStorage`, senha no front, token longo sem rotação.

- Logout invalida a sessão no servidor; expiração por inatividade e absoluta; reautenticação para ações críticas.
- **MFA disponível (obrigatório para administradores).**
- Regenerar sessão após login; mensagens genéricas.
- Links de recuperação/convite: uso único, expiração curta (≤ 1h), alta entropia, armazenados como hash.

## 5. Segurança de API (back)

- [ ] **BOLA/IDOR**: toda rota com `{id}` verifica a posse do recurso.
- [ ] Autenticação: rate limit em login; tokens validados; sem credenciais padrão.
- [ ] Mass assignment: DTOs de entrada com whitelist; saída explícita.
- [ ] Consumo de recursos: limites de body, paginação, timeouts, rate limit, cotas.
- [ ] Rotas admin protegidas por papel e testadas com usuário comum.
- [ ] Fluxos sensíveis protegidos contra automação.
- [ ] SSRF: URLs do usuário por allowlist; bloquear IPs internos/metadados.
- [ ] Configuração: headers, CORS, debug/Swagger desligados, erros genéricos.
- [ ] Inventário de APIs/versões; consumo seguro de terceiros.
- [ ] Injeção: SQL parametrizado, sem `eval`, sem shell com input.
- [ ] Prototype pollution: não fazer merge profundo de objetos do usuário.

## 6. Cadeia de suprimentos (dependências)

- Lockfile commitado; CI com `npm ci`.
- Atualizações via **Dependabot/Renovate** em PRs pequenos e agrupados.
- `npm audit --audit-level=high` (ou osv-scanner) DEVE rodar no CI e bloquear.
- Avaliar dependência nova (manutenção, licença, tamanho, scripts de instalação) e registrar no PR.
- Considerar `--ignore-scripts` e *minimum release age*.
- **SBOM** (CycloneDX) por release; licenças verificadas automaticamente.
- Atualizar Angular a cada major dentro da janela de suporte.

## 7. Segredos

- NUNCA commitar segredos. **Secret scanning + push protection**; `gitleaks` no pre-commit e no CI.
- Segredo vazado = **rotacionar imediatamente**.
- `.gitignore` DEVE conter: `.env*` (exceto `.env.example`), `*.pem`, `*.key`, `*.p12`, `.angular/`, `dist/`, `coverage/`, `node_modules/`.

## 8. Segurança no CI/CD e infraestrutura

- `permissions:` mínimas (`contents: read`); actions de terceiros fixadas por **SHA**; nunca `pull_request_target`
  com checkout do PR; nunca interpolar `${{ github.event.* }}` em `run:`; deploy por OIDC; Environments com reviewers.
- IaC revisada e escaneada; WAF/CDN; TLS 1.2+; contas com MFA e revisão trimestral.

## 9. Mapa OWASP Top 10 → controles

A01 controle de acesso · A02 configuração · A03 cadeia de suprimentos · A04 criptografia · A05 injeção/XSS ·
A06 design inseguro · A07 autenticação · A08 integridade · A09 logs/monitoramento · A10 condições excepcionais —
cada um mapeado para as seções acima e para os docs 02 e 03.

---

# Parte B — Testes

## 10. Estratégia e pirâmide de testes

Muitos unitários → integração/componente → poucos E2E. Testar comportamento observável; testes determinísticos; AAA;
nomes descritivos. **Bug corrigido = teste que o reproduz.** Flaky = bug de alta prioridade. TDD recomendado para
domínio e correções.

## 11. Testes no front (Angular)

Vitest com `*.spec.ts` ao lado; **Angular Testing Library** (consulta por papel/label); mock de HTTP na fronteira.
Cobrir funções puras, stores, componentes (inputs, outputs, estados, a11y), pages, guards/interceptors.

## 12. Testes no back

Unitários com repositórios fake; integração com endpoint real + **banco real**; contrato contra o OpenAPI; cobrir
400/401/403/404 (outro tenant)/409 e o caminho feliz.

## 13. E2E, acessibilidade, visual e performance

**Playwright** nos fluxos críticos (Chromium, WebKit, Firefox, mobile); seletores por papel/label/`data-testid`;
`@axe-core/playwright` sem violações sérias; regressão visual; **Lighthouse CI** (Perf ≥ 90, A11y ≥ 95, BP ≥ 95);
k6 antes de lançamentos.

## 14. Testes de segurança

| Tipo | Ferramenta | Quando |
|------|------------|--------|
| SAST | CodeQL, Semgrep, ESLint security | Todo PR |
| SCA | Dependabot, `npm audit`, osv-scanner | Todo PR + diário |
| Segredos | secret scanning, gitleaks | Pre-commit + todo PR |
| Containers/IaC | Trivy, Checkov | PR que mexe em Docker/IaC |
| DAST | OWASP ZAP baseline | Contra staging, a cada release |
| Autorização | Testes com 2 usuários/tenants | Todo PR de endpoint |
| Pentest | Externo | Antes do go-live e anualmente |

## 15. Cobertura e quality gates

Cobertura mínima **80% de linhas** e **≥ 90% no domínio**; não pode cair em relação à `main`. Gates:
`format:check` · `lint` · `typecheck` · `test` (cobertura) · `build` (budgets) · `e2e` (smoke) · `audit` · `CodeQL` ·
`secret scan` · revisão aprovada.

---

# Parte C — Cuidados gerais

## 16. Observabilidade e incidentes

Captura de erros no front (sem PII) e RUM; logs, métricas RED e traces no back; alertas acionáveis com runbook; SLOs;
incidentes com severidade, responsável e post-mortem sem culpados; plano de incidente de dados (LGPD/ANPD).

## 17. Feature flags e releases seguros

Funcionalidades arriscadas atrás de flag com dono e data de remoção; lançamento gradual; rollback em minutos e testado.

## 18. Checklists do ciclo de vida

### ✅ Definition of Ready do projeto
- [ ] Objetivo, usuários e métricas de sucesso definidos
- [ ] Decisões principais registradas em ADR
- [ ] Repositório configurado (doc 05 §10)
- [ ] CI com todos os quality gates rodando
- [ ] Ambientes `dev`/`staging` provisionados; segredos no cofre
- [ ] Dados pessoais mapeados; bases legais (LGPD) identificadas
- [ ] Modelo de ameaças inicial feito

### ✅ Definition of Ready de uma tarefa
- [ ] Problema e valor claros; critérios de aceite testáveis (Dado/Quando/Então)
- [ ] Design/fluxo disponível quando houver UI (incluindo erro/vazio)
- [ ] Impacto em API/banco/segurança identificado
- [ ] Cabe em ≤ 3 dias (senão, quebrar)

### ✅ Definition of Done de uma tarefa
- [ ] Critérios de aceite atendidos e demonstráveis
- [ ] Código revisado e aprovado; todos os quality gates verdes
- [ ] Testes adequados escritos
- [ ] Checklists de PR dos docs 01/02/03 verificados
- [ ] Acessibilidade e responsividade verificadas (UI)
- [ ] Documentação atualizada (README, OpenAPI, ADR, CHANGELOG via commits)
- [ ] Validado em staging; métricas/logs visíveis
- [ ] Feature flag (se houver) com data de remoção

### ✅ Antes de ir para produção (go-live)
- [ ] Pentest/DAST executado e achados altos/críticos corrigidos
- [ ] Headers e CSP verificados (nota A em securityheaders.com)
- [ ] Backups automáticos ativos **e restauração testada**
- [ ] Monitoramento, alertas e runbooks prontos
- [ ] Teste de carga no fluxo crítico
- [ ] Política de privacidade e termos publicados
- [ ] Plano de rollback documentado e testado
- [ ] Domínio, TLS, DNS e e-mails transacionais (SPF/DKIM/DMARC) configurados

### ✅ Rotina contínua
| Frequência | Atividade |
|------------|-----------|
| Diário | Alertas e erros novos; PRs do Dependabot |
| Semanal | Triagem de bugs e dívida; testes flaky |
| Mensal | Performance e custos; dependências menores |
| Trimestral | Teste de restauração; revisão de acessos; flags antigas |
| Semestral | Upgrade de major do Angular/Node; revisão do padrão |
| Anual | Pentest; modelo de ameaças e inventário de dados pessoais |
