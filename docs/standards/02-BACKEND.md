# 02 · Boas Práticas de Back-end

> Padrão para APIs que servem aplicações Angular. Os princípios valem para qualquer stack (Node/NestJS, .NET, Java/Spring, Go, Python). Os exemplos do original usam **TypeScript + NestJS**.
> Relacionados: [Banco de dados](./03-DATABASE.md) · [Segurança/Testes](./04-SECURITY-TESTING-QA.md) · [Front-end](./01-FRONTEND.md)

---

## 1. Escolha de arquitetura

| Cenário | Recomendação |
|---------|--------------|
| Produto novo, time pequeno/médio | **Monólito modular** (padrão) |
| Front precisa de dados agregados | **BFF** — também resolve autenticação segura por cookie |
| Backend simples / CRUD / protótipo | BaaS com regras de acesso (RLS) |
| Vários times, domínios independentes | Microsserviços — exige ADR |

Princípios: **Clean/Hexagonal light** — o domínio não depende de framework, banco ou HTTP.

## 2. Estrutura de pastas

`main.ts` · `config/` (env validado) · `common/` (filters, guards, interceptors, decorators, pagination) ·
`infra/` (database, cache, queue, mail, storage) · `modules/<domínio>/{api, application, domain, infra, __tests__}` ·
`test/` (integração e e2e).

## 3. Camadas e responsabilidades

| Camada | Faz | NÃO faz |
|--------|-----|---------|
| **Controller (api)** | HTTP, valida DTO, chama caso de uso, devolve DTO, status | Regra de negócio, banco |
| **Use case (application)** | Orquestra regras, transações, autorização de recurso, eventos | HTTP, SQL |
| **Domain** | Entidades, invariantes, cálculos — **puro, testável** | Framework, ORM, HTTP |
| **Repository (infra)** | Persistência, queries, mapeamento | Regra de negócio |

- Dependências apontam para dentro: `api → application → domain ← infra`.
- Entidades de ORM NÃO DEVEM ser retornadas na API — sempre DTO de resposta.
- Um caso de uso por operação relevante.

## 4. Design de API REST

- Substantivos no plural, kebab-case; ações como sub-recurso verbal; aninhamento ≤ 1 nível; JSON em camelCase.
- Versionamento na URL (`/v1`); breaking change = nova versão com `Deprecation`/`Sunset`.
- Status: `400` validação · `401` · `403` · `404` (também para recurso de outro tenant) · `409` · `422` · `429` · `500` · `503`.
- Listas DEVEM ser paginadas com `limit` máximo; cursor para listas grandes; filtros/ordenação por allowlist.
- Datas ISO-8601 UTC; dinheiro em centavos/decimal; IDs públicos opacos; `ETag`/`If-Match`; `Idempotency-Key` em POST sensível.

## 5. Contratos e documentação (OpenAPI)

- A API DEVE expor **OpenAPI 3.1** versionada; o front DEVE gerar tipos a partir dela.
- CI DEVERIA detectar breaking changes (`oasdiff`).
- Swagger/Scalar só em dev/staging; desabilitado ou protegido em produção.

## 6. Validação de entrada

- **Toda** entrada externa DEVE ser validada no servidor (body, query, params, headers, arquivos, filas, webhooks).
- Schema declarativo com whitelist e rejeição de campos extras (anti mass-assignment).
- Limites explícitos de tamanho; validar formato **e** semântica; normalizar antes (trim, lowercase, NFC).

## 7. Tratamento de erros (RFC 9457)

Todas as respostas de erro DEVEM seguir **Problem Details** (`application/problem+json`) com `type`, `title`,
`status`, `detail`, `instance`, `traceId` e `errors[]` (`field`, `code`, `message`).

- Filtro global converte erros de domínio, validação e inesperados.
- 5xx NUNCA expõem stack, SQL ou mensagens internas — só `traceId`.
- `code` estável permite ao front traduzir a mensagem.

## 8. Autenticação e autorização

- NÃO implementar autenticação do zero: usar **OIDC/OAuth 2.1**. Para SPAs, **BFF + cookie** `HttpOnly; Secure; SameSite`.
- JWT: algoritmo fixo, validar `iss`/`aud`/`exp`/`nbf`, vida curta, JWKS com rotação.
- Senhas (se inevitável): `argon2id` (ou bcrypt ≥ 12), mínimo 12, checagem contra vazadas, MFA disponível.
- Força bruta: rate limit por IP **e** por conta, atraso progressivo, mensagens genéricas.
- **Negar por padrão**; permissão por função (RBAC) **e** por recurso (ownership) — falta do segundo = BOLA/IDOR.
- `tenantId` vem da sessão, nunca do body. Autorização fica no back.

## 9. Configuração e segredos

- Variáveis de ambiente **validadas no boot**; não sobe com config inválida.
- `.env` nunca commitado; `.env.example` sempre.
- Segredos em cofre, por ambiente, com rotação; preferir OIDC a chaves longas.

## 10. Logs, métricas e tracing

- **Logs JSON** com `timestamp`, `level`, `message`, `traceId`, `userId` (id), `route`, `durationMs`.
- Correlation ID (`traceparent`) propagado.
- NUNCA logar senhas, tokens, cookies, documentos, PII. Redaction automática.
- **Logs de auditoria** para login, permissão, exclusão, exportação.
- OpenTelemetry; métricas RED. Health checks `GET /health/live` e `GET /health/ready`.

## 11. Performance, cache e resiliência

- Timeouts em TODA chamada externa; retry com backoff + jitter só no idempotente; circuit breaker.
- Rate limiting global e por rota sensível.
- Cache com TTL e invalidação definida; compressão; payloads enxutos; evitar N+1.
- Operações > ~2s DEVERIAM ser assíncronas. Graceful shutdown.

## 12. Tarefas assíncronas e eventos

- Filas para trabalho pesado; consumidores **idempotentes**; dead-letter com alerta; Transactional Outbox.
- Webhooks: HMAC, timestamp anti-replay, 202 rápido. Cron com lock distribuído.

## 13. Uploads e arquivos

- URL pré-assinada curta; tipo por **magic bytes**; tamanho limitado; nome gerado pelo servidor.
- Escanear malware quando compartilhado; buckets privados; não servir upload do mesmo domínio com tipo inferido.

## 14. Containerização e deploy

- Imagem multi-stage, mínima, não-root, versão fixa, escaneada; `.dockerignore`.
- Mesmo artefato promovido entre ambientes; migrations como etapa separada; deploy sem downtime com rollback em um comando.

## 15. Checklist de PR (back)

- [ ] Rota protegida por padrão; autorização de função **e** de recurso/tenant verificada
- [ ] DTO de entrada com validação completa (whitelist, limites) e DTO de saída sem campos sensíveis
- [ ] Erros no formato RFC 9457, sem vazar detalhes internos
- [ ] OpenAPI atualizado; breaking change → nova versão + aviso
- [ ] Queries paginadas, sem N+1, com índice adequado (doc 03)
- [ ] Timeouts e tratamento de falha em chamadas externas
- [ ] Logs estruturados sem PII/segredos; auditoria em ações sensíveis
- [ ] Migration reversível e compatível com a versão anterior do código
- [ ] Testes unitários (domínio/caso de uso) e de integração (endpoint + banco real)
- [ ] Nenhum segredo no código; novas variáveis em `.env.example` e no schema de config
