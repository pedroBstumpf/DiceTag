# 03 · Boas Práticas e Costumes de Banco de Dados

> Padrão de modelagem, nomenclatura, migrations, performance e operação. Referência: **PostgreSQL**, com notas para outros bancos.
> Relacionados: [Back-end](./02-BACKEND.md) · [Segurança/Testes](./04-SECURITY-TESTING-QA.md)

---

## 1. Escolha do banco

PostgreSQL para a maioria dos apps; Redis/Valkey para cache/sessão/filas leves; FTS do PostgreSQL antes de motores de
busca; `jsonb` antes de MongoDB; `pgvector` para vetores. Comece com **um** banco relacional. Novo banco = ADR.
ORM/query builder (Prisma, Drizzle, TypeORM/MikroORM) escolhido em ADR.

## 2. Convenções de nomenclatura

| Objeto | Regra | Exemplo |
|--------|-------|---------|
| Tabelas | `snake_case`, **plural**, inglês | `orders`, `order_items` |
| Colunas | `snake_case`, singular | `created_at`, `customer_id` |
| PK / FK | `id` / `<entidade>_id` | `customer_id` |
| Booleanos | `is_`, `has_`, `can_` | `is_active` |
| Datas | `_at` (timestamp), `_on` (date) | `paid_at` |
| N:N | ambas, ordem alfabética | `products_tags` |
| Índice / único / FK / check | `idx_` / `uq_` / `fk_` / `ck_<tabela>__<colunas>` | `idx_orders__customer_id` |

Sem palavras reservadas nem abreviações obscuras; o ORM mapeia `snake_case` ↔ `camelCase`.

## 3. Modelagem

- 3ª forma normal por padrão; desnormalizar só medido e documentado.
- Toda tabela DEVE ter `id`, `created_at`, `updated_at` (opcionais: `created_by`, `updated_by`, `deleted_at`, `version`).
- `updated_at` atualizado de forma consistente.
- Soft delete com índices únicos parciais; para dados pessoais, preferir exclusão real/anonimização.
- Multi-tenant: `tenant_id NOT NULL` em índices e RLS. Histórico em `audit_log`/`*_history`.
- `jsonb` só para atributos realmente variáveis.

## 4. Tipos de dados

`timestamptz` (UTC), `date`, `numeric(19,4)`/centavos (nunca `float`), `text` + `CHECK` de tamanho, e-mail
normalizado + único, `boolean NOT NULL DEFAULT false`, `uuid`/`bigint`, status por enum/CHECK/tabela, `inet`, `jsonb`.
`NOT NULL` por padrão; defaults explícitos.

## 5. Chaves e identificadores

PK `uuid` v7 ou `bigint identity`. ID exposto NUNCA sequencial previsível. Códigos legíveis são colunas separadas.
Chaves naturais viram `UNIQUE`, não PK.

## 6. Integridade e constraints

FKs para toda relação com `ON DELETE` explícito (`RESTRICT` padrão); `UNIQUE` de negócio; `CHECK` para invariantes;
exclusion constraints para sobreposição; índice em toda coluna de FK.

## 7. Índices

Baseados nas queries reais; compostos com igualdade primeiro; parciais; `GIN`/`pg_trgm` quando cabível; remover os não
usados; `CREATE INDEX CONCURRENTLY` em produção; `EXPLAIN (ANALYZE, BUFFERS)` no PR para tabela grande.

## 8. Queries e acesso pelo código

- **Sempre parametrizadas**; nomes dinâmicos só via allowlist.
- `SELECT *` proibido em código de aplicação.
- Evitar N+1; paginação keyset para listas grandes; cuidado com `COUNT(*)`; operações em massa em lotes.
- Log de queries lentas; pool de conexões dimensionado.

## 9. Transações e concorrência

Transações para alterações dependentes; curtas, sem chamadas externas; `READ COMMITTED` padrão; concorrência otimista
com `version` (0 linhas = 409); idempotência com tabela de chaves; contadores atômicos.

## 10. Migrations

- Toda mudança de schema DEVE ser migration versionada no repositório; alterar banco à mão em ambiente compartilhado é PROIBIDO.
- Nome `YYYYMMDDHHMMSS_descricao`; migrations aplicadas são **imutáveis**.
- Toda migration DEVE ter `down` ou plano de reversão documentado.
- Uma migration = uma mudança lógica; schema separado de migração de dados; rodar no CI do zero.
- Compatível com a versão anterior do código (expand → migrate → contract); `lock_timeout`/`statement_timeout`.
- Destrutivas exigem aprovação explícita e backup verificado.

## 11. Segurança do banco

Usuários distintos (`app_migrator`, `app_runtime`, `app_readonly`); banco nunca exposto à internet; TLS; criptografia
em repouso; colunas sensíveis cifradas na aplicação; senhas só em hash; RLS em multi-tenant; credenciais em cofre;
auditoria de acesso.

## 12. Privacidade e LGPD

Minimização com inventário (finalidade e base legal); colunas pessoais marcadas; **retenção** com expurgo automático;
exportar e excluir/anonimizar dados do titular; ambientes não produtivos sem dados reais; consentimentos versionados.

## 13. Backup, restauração e operação

Backups diários + PITR; 3-2-1, cifrados e imutáveis; **teste de restauração trimestral** em runbook; RPO/RTO
documentados; monitorar conexões, locks, disco, queries lentas; manutenção do autovacuum.

## 14. Seeds e dados de teste

`seed:dev` (fictícios) e `seed:required` (idempotente); testes de integração com banco **real**; isolamento por teste;
factories em vez de fixtures gigantes.

## 15. Checklist de PR (banco)

- [ ] Nomenclatura segue §2; tipos seguem §4 (`timestamptz`, dinheiro sem float)
- [ ] Colunas de auditoria presentes; `NOT NULL`/defaults/constraints definidos
- [ ] FKs com índice e `ON DELETE` explícito; unicidade de negócio garantida no banco
- [ ] Migration versionada, reversível, compatível com o código anterior (expand/contract)
- [ ] Índices novos com `CONCURRENTLY`; `EXPLAIN ANALYZE` das queries novas anexado
- [ ] Sem `SELECT *`, sem N+1, queries parametrizadas, ordenação por allowlist
- [ ] Multi-tenant: `tenant_id` filtrado/RLS aplicada
- [ ] Dados pessoais mapeados, com retenção definida; nenhum dado real em seeds
- [ ] Operações destrutivas com aprovação explícita e backup confirmado
