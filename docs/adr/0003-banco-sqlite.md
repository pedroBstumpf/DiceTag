# ADR-0003: SQLite embutido no lugar de PostgreSQL

- **Status:** Aceito
- **Data:** 2026-11-27
- **Decisores:** @pedroBstumpf

## Contexto

O doc 03 recomenda PostgreSQL. A mesa roda num único processo, numa única máquina Windows (ADR-0001), sem rede
interna nem administrador de banco.

## Opções consideradas

1. **PostgreSQL local** — mais um serviço para instalar, atualizar e proteger no Windows do Mestre.
2. **SQLite (`node:sqlite`) num arquivo da pasta do app** — zero instalação, backup por `VACUUM INTO`, isolado pelo
   `--permission` do Node. Escolhida.

## Decisão

SQLite, com migrações versionadas em `server/src/db/migrations.ts` e backup automático antes de migrar.

Regras do doc 03 que **continuam valendo**: nomenclatura (`snake_case`, plural), FKs com `ON DELETE` explícito e
índice, queries parametrizadas, sem `SELECT *` (backlog D5), colunas de auditoria (D7), migrations imutáveis, LGPD,
backup 3-2-1 com restauração testada. Itens específicos do PostgreSQL (RLS, `CONCURRENTLY`, usuários de banco
distintos, PITR) não se aplicam: o isolamento é por processo e pelo `--permission`.

**Rollback de migration:** não há `down`; o plano de reversão é o backup feito automaticamente antes de cada
migração + `npm run restaurar` (documentado em `server/OPERATIONS.md`).

## Consequências

- Simples de operar e de fazer backup. Não escala para vários servidores — o que não é um requisito (ADR-0001).
- Hospedar em nuvem no futuro implica reavaliar este ADR junto com o 0001.
