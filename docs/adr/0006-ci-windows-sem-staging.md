# ADR-0006: CI no Windows; sem staging/produção hospedados

- **Status:** Aceito
- **Data:** 2026-11-27
- **Decisores:** @pedroBstumpf

## Contexto

O doc 05 §7 sugere `ubuntu-latest` e deploys automáticos para staging e produção. A mesa roda de verdade no Windows
(ADR-0001), onde caminhos, permissões do Node (`--permission`) e o Funnel se comportam de forma diferente.

## Decisão

- Os jobs de qualidade rodam em **`windows-latest`**, o sistema onde a mesa roda.
- CodeQL e a checagem do título do PR rodam em `ubuntu-latest` (não dependem do SO e são mais rápidos).
- Não há `deploy-staging.yml` nem `deploy-production.yml`. "Produção" = o dono atualiza a `main` (ou uma tag) no
  computador da mesa e roda `npm run mesa`. O substituto do staging é `npm run e2e` + `npm run smoke` antes da release.
- Releases continuam com SemVer e tags `vX.Y.Z`; release-please entra no backlog (V13).

## Consequências

- CI um pouco mais lento (runners Windows), em troca de pegar problemas reais do ambiente da mesa.
- Os checks obrigatórios da `main` são: `Front-end (build e testes)`, `Servidor (tipos, testes e audit)`, `Qualidade
  (lint e formatação)`, `CodeQL` e `Título do PR`.
