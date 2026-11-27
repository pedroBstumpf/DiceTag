# Architecture Decision Records

Decisões do Game Master's Dream, principalmente as que divergem dos padrões em [`../standards/`](../standards/).
Novo ADR: copie `0000-template.md` com o próximo número.

| ADR | Decisão | Status |
|---|---|---|
| [0001](0001-hospedagem-windows-tailscale.md) | Mesa hospedada no Windows do Mestre, aberta pela internet só via Tailscale Funnel | Aceito |
| [0002](0002-backend-fastify.md) | Back-end em Fastify + zod, monólito, rotas `/api` sem versão | Aceito |
| [0003](0003-banco-sqlite.md) | SQLite embutido no lugar de PostgreSQL | Aceito |
| [0004](0004-autenticacao-propria.md) | Autenticação própria (convite + senha + cookie) no lugar de OIDC | Aceito |
| [0005](0005-ui-angular-material.md) | Angular Material + CDK como biblioteca de UI; budgets maiores | Aceito |
| [0006](0006-ci-windows-sem-staging.md) | CI no Windows; sem staging/produção hospedados | Aceito |
| [0007](0007-painel-do-mestre.md) | Painel do Mestre: uma tela para convidar, criar e gerenciar mesas | Aceito |
