# Runbook — abrir a mesa para os jogadores (Windows + Tailscale Funnel)

Referência: [ADR-0001](../adr/0001-hospedagem-windows-tailscale.md). Operação do servidor (backup, restauração,
hospedagem): [`server/OPERATIONS.md`](../../server/OPERATIONS.md).

## Uma vez por mês (ou antes de uma campanha nova)

- [ ] Windows Update em dia e Microsoft Defender ativo.
- [ ] Tailscale atualizado (`tailscale version`) e a conta do Tailscale com **MFA** ligado.
- [ ] No painel do Tailscale, conferir que o Funnel está liberado **só para esta máquina** e que não há outras
      máquinas antigas na tailnet.
- [ ] `npm run restaurar` num backup recente do Drive: a cópia abre e a conferência passa.
- [ ] `git pull` na `main` (ou checkout da última tag) e `npm ci` na raiz e em `server/`.
- [ ] `npm audit --omit=dev` na raiz e em `server/` sem vulnerabilidades altas.

## Antes de cada sessão

1. `Iniciar mesa.cmd` (ou `npm run mesa`). Não rode `npm start` do servidor para jogar: só o `npm run mesa` isola o
   servidor com `--permission` e controla o túnel.
2. Confira no terminal: servidor em `127.0.0.1`, backup do Drive feito ao abrir.
3. No **Painel do Mestre** (`/mestre`), clique em "Abrir para os jogadores". O endereço é `https://<máquina>.ts.net`.
4. Gere convites só para quem vai entrar agora (valem 7 dias, uso único). Cancele os que sobraram depois.

## Depois da sessão

1. Feche o terminal da mesa (ou Ctrl+C): o túnel cai junto e o banco é copiado para o backup.
2. Confira que `tailscale funnel status` não mostra nada aberto.

## Antes de cada release (substitui o staging — ADR-0006)

- [ ] CI verde na `main`.
- [ ] `npm run build` na raiz, depois `npm run e2e` e `npm run smoke` em `server/`.
- [ ] Com a mesa aberta, conferir o endereço `*.ts.net` em <https://securityheaders.com> (alvo: nota A) e no
      Mozilla Observatory.
- [ ] (Quando entrar no backlog S17) `zap-baseline` contra a mesa local.

## Incidente: suspeita de acesso indevido

1. Feche a mesa (o túnel cai).
2. `npm run dono` → troque a senha do dono. No painel, tire os jogadores suspeitos e cancele os convites.
3. Em `server/`, `npm run reset-link -- <e-mail>` se precisar recuperar o acesso.
4. Procure no log os eventos `limite.atingido`, `permissao.negada`, `ws.recusado`, `ws.comando_negado` e `login.ok`
   de horários estranhos (falhas de login ainda não geram evento próprio: backlog B14).
5. Se houver dados pessoais expostos, avalie a comunicação aos jogadores (LGPD).
