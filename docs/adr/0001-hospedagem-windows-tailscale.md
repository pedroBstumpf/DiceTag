# ADR-0001: Mesa hospedada no Windows do Mestre, aberta pela internet só via Tailscale Funnel

- **Status:** Aceito
- **Data:** 2026-11-27
- **Decisores:** @pedroBstumpf

## Contexto

O Game Master's Dream é usado por um grupo pequeno: o Mestre (dono do app) narra a partir do próprio computador com
Windows e os jogadores entram de qualquer aparelho. Os padrões (doc 02 §14, doc 05 §7) supõem um servidor hospedado,
com staging, produção, containers e Environments. O dono quer explicitamente **manter a mesa rodando no Windows via
Tailscale, da forma mais segura possível**.

## Opções consideradas

1. **Hospedar em nuvem (VPS/PaaS + PostgreSQL)** — segue os padrões ao pé da letra; custo mensal, mais uma
   superfície para manter (SO, TLS, backups), e os arquivos da biblioteca do Mestre teriam de subir para a nuvem.
2. **Port forwarding no roteador** — expõe o IP de casa, exige TLS e DNS próprios. Descartada.
3. **Tailscale Funnel no computador do Mestre** — HTTPS com certificado válido em `*.ts.net`, sem abrir portas no
   roteador nem expor o IP, liga e desliga por sessão de jogo. Escolhida.

## Decisão

A mesa roda no Windows do Mestre com `npm run mesa` / `Iniciar mesa.cmd`. O acesso pela internet acontece **apenas**
pelo Tailscale Funnel, aberto pelo botão "Abrir para os jogadores" e fechado ao encerrar a mesa. Não haverá staging
nem produção hospedados enquanto essa for a forma de uso.

## Modelo de ameaças (STRIDE) da exposição pela internet

| Ameaça | Controle que já existe | Risco residual / ação |
|---|---|---|
| **S**poofing — alguém se passar por jogador ou pelo Mestre | Só por convite (192 bits, uso único, 7 dias, hash); senhas scrypt + pimenta; cookie `__Host-` HttpOnly/Secure/SameSite=Strict; throttle por IP e por conta | Mestre sem MFA → backlog **B11** (TOTP obrigatório para o dono com o túnel aberto) |
| **T**ampering — alterar estado ou arquivos | Servidor autoritativo: todo comando com `strictObject`, regras por papel (`command-rules`, `sheet-rules`); CSRF por origem + SameSite | — |
| **R**epudiation | `audit()` em login, permissão negada, limites, convites | Definir retenção dos logs (**D11**) |
| **I**nformation disclosure | Visão/névoa calculadas no servidor (jogador não recebe paredes nem o que não vê); 404 para mesa alheia; EXIF removido; biblioteca nunca é servida aos jogadores | Fontes do Google Fonts revelam o IP do jogador ao Google → servir localmente (**S3**) |
| **D**enial of service | Rate limit HTTP e por mensagem de WebSocket; limites de bytes/nós no JSON; cotas de upload | Funnel tem limites próprios; aceitável para um grupo pequeno |
| **E**levation of privilege | Servidor roda com `--permission` do Node (só lê o código/app/pasta do app, só grava na pasta do app, não executa programas); controle do túnel por IPC com operações fixas; `/api/host` só para o dono **e** só de `127.0.0.1` sem cabeçalhos de proxy | Manter o Windows e o Tailscale atualizados (runbook) |

### Regras que este ADR torna obrigatórias

1. O servidor escuta **somente em `127.0.0.1`** (`HOST` padrão). Nunca `0.0.0.0`.
2. A única entrada externa é o Funnel; a origem `*.ts.net` só é aceita depois que o processo principal a informa
   (`allowPublicOrigin`), nunca por variável editável no app.
3. Abrir/fechar o túnel e abrir a pasta exigem acesso local direto (`isDirectLocal`). Nenhuma rota pública controla o túnel.
4. O túnel morre junto com a mesa (processo em primeiro plano, sem shell) e é desligado no início se tiver sobrado.
5. Segredos só no `segredos.env` da pasta do app (fora do repositório e fora do backup na nuvem).
6. O servidor isolado nunca executa programas; quem fala com o `tailscale` é só o processo principal.
7. Antes de cada release: checklist do runbook [`../runbooks/mesa-online.md`](../runbooks/mesa-online.md).

## Consequências

- **Mais fácil:** custo zero, dados ficam na máquina do Mestre, biblioteca local, sem DNS/TLS para manter.
- **Mais difícil:** a mesa só existe com o computador ligado; não há staging. O papel do staging é feito pelo
  `npm run e2e` (dois navegadores, Tailscale de mentira) e pelo `npm run smoke`.
- Os itens de deploy/Environments do doc 05 §7 e de observabilidade (alertas, SLO) do doc 04 §16 ficam **fora de
  escopo** enquanto este ADR valer. Hospedar em nuvem no futuro exige um novo ADR que substitua este.
