# ADR-0002: Back-end em Fastify + zod, monólito, rotas `/api` sem versão

- **Status:** Aceito
- **Data:** 2026-11-27
- **Decisores:** @pedroBstumpf

## Contexto

O doc 02 usa NestJS nos exemplos e pede rotas versionadas (`/v1`), OpenAPI e erros RFC 9457. O servidor já existe,
está testado (275 testes) e auditado contra o `BACKEND_SECURITY.md`. Ele reaproveita as regras puras do front
(`server/src/domain` importa de `src/app`).

## Opções consideradas

1. **Migrar para NestJS** — alinha aos exemplos; reescrita grande sem ganho de segurança ou funcionalidade.
2. **Manter Fastify 5 + zod** — já segue os princípios do doc 02 (monólito modular, domínio sem framework,
   validação estrita, negar por padrão). Escolhida.

## Decisão

- Mantém Fastify 5 + zod, monólito em `server/`.
- **Sem `/v1`:** front e back são publicados juntos, do mesmo repositório, na mesma máquina (ADR-0001); não há
  cliente de terceiros. Se surgir um cliente externo (app mobile, bot), a versão entra antes dele.
- **RFC 9457 e OpenAPI continuam obrigatórios** e entram no backlog (B4, B6). A migração de erros mantém o campo
  `error` atual para o front não quebrar.

## Consequências

- Nenhuma reescrita; o padrão vale pelos princípios, não pelo framework.
- Novos endpoints seguem o checklist do doc 02 §15 normalmente.
