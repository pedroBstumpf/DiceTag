# Política de Segurança

## Como reportar

**Não abra issue pública.** Use "Report a vulnerability" na aba **Security** deste repositório
(<https://github.com/pedroBstumpf/DiceTag/security/advisories/new>). A resposta vem em até 7 dias.

Inclua, se possível: o que você conseguiu fazer, os passos para reproduzir e a versão (`package.json`). Não inclua
senhas, convites ou dados de outras pessoas.

## Versões suportadas

Só a versão mais recente (`main` / última tag) recebe correções de segurança.

## Escopo

O app roda no computador do Mestre e é aberto pela internet só pelo Tailscale Funnel
([ADR-0001](docs/adr/0001-hospedagem-windows-tailscale.md)). Os controles do servidor estão em
[`BACKEND_SECURITY.md`](BACKEND_SECURITY.md). Testes de segurança contra uma mesa que não é sua não são autorizados.
