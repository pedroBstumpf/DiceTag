# Operação segura do servidor — Crônicas de Zehenia

Guia para publicar e manter o servidor (`server/`) em produção. Complementa o
[`BACKEND_SECURITY.md`](../BACKEND_SECURITY.md) (regras do código) e o [`README.md`](README.md)
(como rodar localmente). Nada aqui é executado pelo assistente de IA contra o servidor de produção.

---

## 1. Onde hospedar

O servidor precisa de um processo sempre ligado (WebSocket) e de disco que não se apaga (banco SQLite e arquivos). Serve
uma VPS ou uma plataforma com volume persistente; não servem hospedagens "serverless" nem as que apagam o disco a cada
publicação. Sugestão de início: 1 a 2 GB de memória (cada login usa ~128 MB por um instante).

**Não abra uma porta do seu computador para a internet.** O jogo não precisa disso: há um servidor só, e os jogadores
conectam nele pelo navegador, sem instalar nem abrir nada. Hospedar em casa com redirecionamento de porta expõe o seu IP e
a sua rede, torna o seu computador parte do alvo de qualquer falha e deixa o jogo fora do ar quando ele desliga. Para um
teste rápido entre amigos sem contratar nada, prefira um túnel (Cloudflare Tunnel, Tailscale), que não abre porta.

**Por que só SQLite:** ele guarda contas, mesas e o mundo, e os arquivos ficam em disco (`FILES_DIR`), com o banco só
referenciando cada um. É o bastante para um servidor só. Um banco externo só passa a valer com mais de uma instância, o
que hoje exige também tirar as salas e os limites de taxa da memória. Se o disco virar problema, o passo natural é levar os
arquivos para um armazenamento de objetos (S3, R2) e manter o resto.

---

## 2. Antes de publicar

| Item | Como |
|---|---|
| HTTPS e `wss://` | TLS no proxy reverso (nginx, Caddy) ou na hospedagem. HSTS já sai do servidor com `NODE_ENV=production`. |
| `NODE_ENV=production` | Com ele, o servidor **não sobe** se `COOKIE_SECURE=false`, `DEV_TOOLS=true`, `RATE_LIMIT=false`, `PASSWORD_COST<17`, origem sem HTTPS ou segredo repetido. |
| Proxy reverso | `TRUSTED_PROXIES` com o IP do proxy (ex.: `127.0.0.1`). Nunca liste faixas de onde clientes conectam. |
| Origens | `ALLOWED_ORIGINS` só com os domínios de produção (`https://...`), sem curinga. |
| Segredos | Gerados para produção (seção 3), fora do Git, com backup separado do banco. |
| Node | Versão LTS do `.nvmrc` (linhas 22.13+ ou 24), com as atualizações de segurança. O `node:sqlite` ainda é experimental (Stability 1.1): confira as notas de versão antes de atualizar. |
| Usuário do processo | Sem privilégios de administrador; dono só da pasta `data/` (o servidor cria o banco 600 e as pastas 700). |
| Dependências | `npm ci --omit=dev` no servidor, já que o `tsx` é dependência de produção (lockfile); e, numa cópia de desenvolvimento, `npm run check` (tipos, testes e `npm audit`) sem vulnerabilidade alta ou crítica. |
| Execução | `npm start` (sem `--inspect`). |
| App (front-end) | `npm run build` na raiz e `FRONTEND_DIR` apontando para `dist/zehenia/browser`: o servidor entrega o app na mesma origem da API, com CSP própria (scripts só do servidor). Ou sirva os arquivos pelo proxy reverso e deixe `FRONTEND_DIR` vazio. |
| E-mail | `MAIL_PROVIDER=resend`, `MAIL_API_KEY` e `MAIL_FROM` (domínio verificado no serviço) e `PUBLIC_URL` com o endereço do app. Sem isso, a recuperação de senha só funciona por `npm run reset-link -- <e-mail>`. O servidor não sobe com `MAIL_PROVIDER=log` em produção. |
| Backup | Agendado e com uma restauração testada (seção 4). |
| Privacidade | Política de privacidade publicada (seção 7) e exclusão de conta funcionando (`DELETE /api/auth/me`). |

---

## 3. Segredos

Gere cada um com `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`.
Use segredos **diferentes** em desenvolvimento e em produção. Os de produção ficam só no painel da
hospedagem (ou num gerenciador de segredos) e têm backup **separado** do banco: perder a pimenta
invalida todas as senhas. Nunca registre `process.env` em log.

| Segredo | Para que serve | Como trocar | Efeito da troca |
|---|---|---|---|
| `TOKEN_SECRET` | HMAC dos tokens de sessão e dos convites; referência do e-mail no log | Gere outro e reinicie | Todas as sessões e convites deixam de valer (logout geral). É a primeira medida num incidente. |
| `PASSWORD_PEPPER` | HMAC das senhas antes do scrypt | 1) some 1 em `PASSWORD_PEPPER_VERSION`; 2) mova a pimenta atual para `PASSWORD_PEPPERS_PREVIOUS` (`<versão antiga>:<pimenta>`); 3) gere a nova; 4) reinicie | Nenhuma senha deixa de valer: cada uma é refeita com a pimenta nova no próximo login. Retire a antiga de `PASSWORD_PEPPERS_PREVIOUS` quando não houver mais hashes dela (ou aceite que quem não entrou desde então redefina a senha). |
| `SEED_PASSWORD` | Contas de exemplo do `npm run seed` | — | Só desenvolvimento: não rode o seed em produção. |

---

## 4. Backups

- **Fazer:** `npm run backup` grava em `data/backups/<data e hora>/` uma cópia consistente do banco
  (`VACUUM INTO`, seguro com o servidor no ar) e dos arquivos enviados, e já confere a cópia.
  O servidor também faz uma cópia do banco sozinho antes de aplicar migrações.
- **Agendar:** uma vez por dia, por exemplo com o cron (`0 4 * * * cd /srv/zehenia/server && npm run backup`).
- **Cifrar e tirar do servidor:** o backup local não protege contra perder o servidor. Leve cada
  cópia, cifrada, para outro lugar com a ferramenta de backup da hospedagem ou com o
  [restic](https://restic.net) (cifra AES-256 e envia a um armazenamento externo).
- **Guardar:** sugestão de 7 cópias diárias, 4 semanais e 6 mensais. Apague as locais depois de
  enviadas.
- **Testar a restauração** (todo mês e depois de mudanças no servidor): traga uma cópia de volta,
  decifre e rode `npm run backup:check -- <pasta>`. Backup nunca restaurado não é garantia.
- **Restaurar:** pare o servidor, guarde a pasta `data/` atual à parte, copie `zehenia.db` e `files/`
  da cópia para `data/` e suba o servidor (as migrações que faltarem são aplicadas na subida).
- Contas excluídas continuam nos backups até a cópia mais antiga sair do ciclo (no máximo 6 meses
  na sugestão acima): diga isso na política de privacidade.

---

## 5. Logs

- O servidor escreve em JSON (pino) na saída padrão; a hospedagem guarda. **Prazo de guarda: 90
  dias**, depois apagar. Os logs têm IP (dado pessoal): acesso só para quem administra o servidor.
- Nunca entram: senhas, cookies, tokens, códigos de convite, pimentas, e-mails (o login com falha
  aparece só como `emailRef`, um HMAC truncado) nem pilhas de erro na resposta ao cliente.
- **Eventos de segurança** têm o campo `security`. Vale alertar quando aparecem muitos:

  | Evento | O que indica |
  |---|---|
  | `login.falha`, `login.bloqueado` | Adivinhação de senha (veja `emailRef` e `ip`) |
  | `limite.atingido` | Abuso de uma rota ou robô |
  | `permissao.negada`, `ws.comando_negado` | Alguém tentando o que não pode (às vezes, erro do front) |
  | `ws.recusado`, `ws.mensagem_invalida` | Origem estranha, sessão vencida ou cliente adulterado |
  | `upload.recusado` | Tentativa de enviar formato proibido ou além da cota |
  | `senha.recuperacao_sem_email` | Alguém pediu recuperação de senha, mas não há serviço de e-mail configurado |
  | `conta.criada`, `login.ok`, `sessao.encerrada`, `sessoes.encerradas`, `senha.trocada`, `senha.recuperacao_pedida`, `senha.redefinida`, `conta.excluida` | Rotina (auditoria) |

- Um erro 500 devolve ao cliente só `requestId`; procure esse id no log para achar o detalhe.

---

## 6. Plano de incidente

1. **Detectar:** alertas dos eventos acima, aviso de um usuário ou de quem hospeda.
2. **Conter (na hora):**
   - trocar o `TOKEN_SECRET` e reiniciar (todas as sessões caem);
   - bloquear IPs no proxy;
   - se preciso, tirar o servidor do ar;
   - se a pimenta ou o banco vazaram, trocar a pimenta e pedir a todos que troquem a senha.
3. **Avaliar:** o que vazou, de quem, desde quando (logs pelo `requestId`, `userId`, `ip`; backups).
4. **Corrigir:** a causa, com teste que a reproduza, e só então voltar ao ar.
5. **Comunicar:** os usuários afetados, em linguagem clara. Se houver risco ou dano relevante a
   eles, comunicar também a ANPD — o Regulamento de Comunicação de Incidente de Segurança
   (Resolução CD/ANPD nº 15/2024) fixa o prazo em 3 dias úteis. **Confirme as obrigações com um
   profissional.**
6. **Registrar:** o que aconteceu, o que foi feito e o que muda, para a próxima vez.

---

## 7. Privacidade (LGPD)

- **Coletado:** e-mail, nome de exibição e senha (só o hash); o conteúdo que a pessoa cria
  (mundos, mesas, fichas, arquivos); IP e horários nos logs (90 dias).
- **Direitos do titular, já no servidor:** baixar todos os dados (`GET /api/auth/me/export`) e excluir
  a conta (`DELETE /api/auth/me`, com a senha), o que apaga em cascata mesas próprias, Worldbuild,
  arquivos e as fichas da pessoa nas mesas de outros mestres.
- **Pendente (do responsável pelo projeto):** a **política de privacidade**, que é um texto jurídico
  com a identificação de quem trata os dados, as finalidades acima, os prazos (logs, backups) e o
  contato para os titulares.
- Fotos podem ter localização (EXIF): o app remove os metadados de JPEG, PNG e WebP antes de enviar
  (`core/utils/image-metadata.ts`). A remoção é no navegador, então protege contra o descuido de quem envia;
  um cliente adulterado só exporia os próprios dados. O servidor só aceita imagens e áudio, sem alterar o conteúdo.
- E-mail de recuperação de senha: com um serviço como o Resend, o endereço da pessoa passa por ele. Diga isso
  na política de privacidade.

---

## 8. Riscos conhecidos e aceitos

| Risco | Por que foi aceito | Quando rever |
|---|---|---|
| O cadastro responde 409 para e-mail já usado (dá para saber se um e-mail tem conta) | Sem e-mail de verificação, não há como esconder sem quebrar o cadastro; há limite por IP | Quando houver verificação por e-mail |
| Arquivo de mundo pode ser baixado por qualquer membro de mesa daquele mundo que tenha o id | O id é um UUID aleatório (122 bits) que só chega a quem pode ver o item; a regra do §8 (membro da mesa) é cumprida | Se ids passarem a vazar (ex.: links compartilhados) |
| O jogador recebe a imagem inteira do mapa (a névoa é desenhada por cima) | Decisão do SPEC §3.1, como nos VTTs mais usados; recortar por jogador é caro | Se virar problema nas mesas |
| Cadastro aberto, sem verificação de e-mail: qualquer um cria conta e usa a cota de arquivos | Há limite por IP e cota por conta; com poucos usuários, o disco aguenta | **Antes de abrir ao público:** verificação de e-mail ou cadastro só por convite |
| Duas pessoas editando a mesma ficha ao mesmo tempo: vale a última gravação | A ficha ainda é gravada inteira; quase sempre só o dono a edita | Com os comandos por campo (SPEC §1) |
| A memória da névoa (áreas exploradas) é gravada pelo cliente do mestre | Só o mestre pode gravá-la; calcular no servidor exige o tamanho do mapa (SPEC §1) | Na ligação do front ao servidor |
| Limites de taxa e de login em memória | Um processo só | Se rodar mais de uma instância (usar um armazenamento compartilhado, como Redis) |
| Comandos que gravam a ficha inteira aceitam até 512 KB | A ficha tem anotações em texto rico; o resto das mensagens tem limite de 16 KB | Com os comandos por campo (SPEC §1) |
