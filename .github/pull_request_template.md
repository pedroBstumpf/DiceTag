## O que muda
<!-- Resumo em 1–3 frases. O que e por quê. -->

Closes #

## Tipo
- [ ] feat  - [ ] fix  - [ ] refactor  - [ ] perf  - [ ] docs  - [ ] chore  - [ ] breaking change

## Como testar
1.
2.

## Evidências
<!-- Prints (desktop e mobile, Mestre e jogador), mesa local e online quando aplicável. -->

## Checklist
- [ ] Segui os checklists aplicáveis: [Front](../blob/main/docs/standards/01-FRONTEND.md#17-checklist-de-pr-front) · [Back](../blob/main/docs/standards/02-BACKEND.md#15-checklist-de-pr-back) · [Banco](../blob/main/docs/standards/03-DATABASE.md#15-checklist-de-pr-banco)
- [ ] Testes adicionados/atualizados e passando (`npm run build`, `npx ng test --watch=false`, `npm run check` em `server/`)
- [ ] Sem segredos, dados pessoais em logs, `console.log` ou código comentado
- [ ] Rotas novas nascem protegidas; autorização de papel **e** de mesa/recurso verificada no servidor
- [ ] Comando novo da mesa: esquema em `command-schemas.ts` e regra em `command-rules.ts`
- [ ] Migração compatível com a versão anterior (backup automático antes de migrar)
- [ ] Acessibilidade e responsividade verificadas (se UI)
- [ ] `CLAUDE.md`, README, ADR ou runbook atualizados

## Riscos e rollback
<!-- O que pode dar errado? Como reverter? -->
