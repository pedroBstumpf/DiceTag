# Guia da mesa: instalar, testar e jogar com os amigos

Este guia é para a **máquina principal**: o computador que vai rodar a mesa durante as sessões. Siga na ordem
na primeira vez. Depois, para cada sessão, basta a seção 6.

> Resumo: o seu computador é o servidor. O **Google Drive para computador** guarda um backup cifrado e o
> **Tailscale** cria um endereço `https://…ts.net` para os amigos entrarem de qualquer lugar. Os amigos **não
> instalam nada**: só abrem o endereço no navegador.

---

## 1. O que instalar (uma vez)

| Programa | Para quê | Onde |
|---|---|---|
| **Node.js LTS** (22 ou 24) | Roda o app | https://nodejs.org |
| **GitHub Desktop** | Baixa o projeto e as atualizações | https://desktop.github.com |
| **Google Drive para computador** | Backup automático | https://www.google.com/drive/download/ |
| **Tailscale** | Endereço público para os amigos | https://tailscale.com/download |

Depois de instalar:

1. **Projeto:** no GitHub Desktop, *File → Clone repository* → `pedroBStumpf/DiceTag`. Guarde onde quiser (ex.:
   `Documentos\Projetos\dicetag`).
2. **Google Drive:** entre com a sua conta Google. Confira no Explorador do Windows que apareceu o **"Meu Drive"**
   (numa unidade como `G:` ou numa pasta da sua conta do Windows). O app procura sozinho nos dois lugares.
3. **Tailscale:** entre com uma conta (dá para usar a mesma do Google). O ícone do Tailscale aparece perto do
   relógio e deve dizer *Connected*.

> **Importante:** o Tailscale precisa estar **conectado antes** de iniciar a mesa. O app lê o endereço público
> ao iniciar; se você conectar o Tailscale depois, feche e abra a mesa de novo.

---

## 2. Primeira vez que a mesa abre

1. Na pasta do projeto, dê **dois cliques em `Iniciar mesa.cmd`**.
2. Na primeira vez ele instala o que falta (alguns minutos) e compila o app.
3. Ele pede **a sua conta de dono**: nome, e-mail e senha. Essa é a única conta criada pelo terminal. Os
   jogadores ganham as contas deles pelo convite.
4. O navegador abre em `http://localhost:3000`. Entre com o e-mail e a senha que você acabou de criar.

Tudo o que é seu fica em **`Documentos\Cronicas de Zehenia`**, fora do projeto:

| Pasta / arquivo | O que é |
|---|---|
| `dados\` | O banco de dados (contas, mesas, mundos, partidas) |
| `arquivos-da-mesa\` | Mapas, tokens, sons e imagens enviados às mesas |
| `biblioteca\` | A sua biblioteca de imagens e sons (organize pelo Explorador do Windows) |
| `segredos.env` | As chaves do app. **Nunca compartilhe**. Sem ele, ninguém entra e o backup não abre |

> **Trazer os dados do outro computador:** com a mesa **fechada nos dois computadores**, copie a pasta inteira
> `Documentos\Cronicas de Zehenia` (inclusive o `segredos.env`) para o mesmo lugar na máquina principal.
> O que você criou só no navegador ("Neste navegador") vai pela cópia `.zehenia`: em Minhas mesas,
> **Salvar cópia** num computador e **Importar cópia** no outro.

---

## 3. Testar o backup no Google Drive

Com o Drive instalado, o backup é automático: **ao abrir a mesa, a cada 1 hora e, só o banco, ao fechar**.

1. Abra a mesa (`Iniciar mesa.cmd`). Na janela preta deve aparecer:
   ```
   Backup no Google Drive: G:\Meu Drive\Cronicas de Zehenia - backup
   Backup no Drive: banco ok · 0 arquivo(s) da mesa novo(s) · biblioteca +0 −0.
   ```
   Se aparecer *"o Google Drive para computador não foi encontrado"*, confira se o "Meu Drive" está visível no
   Explorador e abra a mesa de novo.
2. **Guarde o `segredos.env` agora.** O primeiro backup acrescenta nele a `BACKUP_KEY`, a chave que abre os
   backups. Copie `Documentos\Cronicas de Zehenia\segredos.env` para **fora da nuvem**: um pendrive ou um
   gerenciador de senhas. Ele **não** vai para o Drive, de propósito.
3. Abra o Google Drive (no navegador) e veja a pasta **Cronicas de Zehenia - backup**:
   - `banco\` — cópias cifradas do banco (ficam as 14 mais novas);
   - `arquivos-da-mesa\` — arquivos das mesas, cifrados;
   - `biblioteca\` — a sua biblioteca, legível (dá para abrir as imagens de qualquer aparelho);
   - `LEIA-ME.txt`.
4. **Teste a restauração** (sem medo: não mexe nos seus dados). Abra um terminal na pasta `server` do projeto
   (no Explorador, clique na barra de endereço, digite `cmd` e Enter) e rode:
   ```
   npm run restaurar
   ```
   Deve terminar com *"A cópia está inteira"* e mostrar contas, mundos, mesas e arquivos. A cópia fica em
   `Documentos\Cronicas de Zehenia\restauracoes\` (pode apagar depois).

Outros comandos (na pasta `server`):

| Comando | O que faz |
|---|---|
| `npm run backup-drive` | Faz um backup agora, com a mesa aberta ou fechada |
| `npm run restaurar -- --banco <nome>.db.zhb` | Restaura uma cópia específica da pasta `banco\` |
| `npm run restaurar -- --de <pasta>` | Restaura de outro lugar (ex.: outro computador) |
| `npm run mesa -- --sem-backup` | Abre a mesa sem backup |

**Se o computador quebrar:** num computador novo, faça as seções 1 e 2 (pode criar um dono qualquer), feche a
mesa, coloque o seu `segredos.env` guardado em `Documentos\Cronicas de Zehenia\`, rode `npm run restaurar` e siga
os passos que ele mostra no fim.

---

## 4. Testar o Tailscale (a mesa na internet)

1. Com a mesa aberta, vá em **Minhas mesas**. O painel da mesa mostra a situação:
   - *Falta instalar o Tailscale* / *Entre na sua conta do Tailscale*: resolva a seção 1 e abra a mesa de novo.
   - *Mesa fechada*: tudo pronto.
2. Clique em **Abrir para os jogadores**.
3. **Na primeira vez**, aparece *"Falta aprovar uma vez"*: clique em **Abrir a página de aprovação**. Na página
   do Tailscale, autorize o *Funnel* para este computador (pode pedir para ligar o HTTPS da sua rede Tailscale;
   aceite). Volte ao app e clique em **Abrir para os jogadores** de novo.
4. Quando aparecer **"Mesa aberta para os jogadores"**, o endereço `https://<computador>.<rede>.ts.net` aparece
   ao lado, com o botão de copiar.
5. **Teste de fora:** no celular, **desligue o Wi-Fi** (use os dados móveis) e abra esse endereço. Deve aparecer
   a página de entrada do app. Se abrir, a internet inteira consegue chegar à sua mesa (mas só entra quem tem conta).
6. **Teste o convite:** numa mesa online, **Gerar convite**, copie o link e abra no celular. Crie um jogador de
   teste (nome e senha). Depois, no celular, saia e entre de novo em **Entrar**, com o nome e a senha.
7. Clique em **Fechar a mesa** (ou feche a janela preta): o endereço deixa de funcionar na hora.

> **Mantenha o nome do computador no Tailscale fixo.** O endereço `…ts.net` vem dele; trocar o nome muda o
> endereço, e os jogadores precisam entrar de novo (com nome e senha, sem convite).

---

## 5. Convidar os amigos (uma vez por amigo)

1. Em **Minhas mesas → Mesas online**, crie a mesa (se ainda não existe).
2. Abra a mesa para os jogadores (seção 4) **antes** de gerar o convite: assim o link já sai com o endereço
   público.
3. No menu da mesa, **Gerar convite**. O link aparece **uma vez só** e vale para **uma pessoa**, por 7 dias.
   Mande por WhatsApp/Discord para o amigo.
4. O amigo abre o link, escolhe o **nome que os outros vão ver** e uma **senha**. Pronto: ele tem conta.

O nome é único (sem diferenciar maiúsculas e acentos: "Lyra" e "lýra" são o mesmo). Ninguém consegue ver as
senhas, nem você.

---

## 6. Cada sessão de jogo

1. **Antes:** confira que o Tailscale está conectado e desligue a suspensão do computador (Configurações →
   Sistema → Energia: "Nunca" enquanto joga).
2. Dois cliques em **`Iniciar mesa.cmd`**. Espere a linha *"Backup no Drive: banco ok"*.
3. **Minhas mesas → Abrir para os jogadores.**
4. Mande o endereço `https://…ts.net` para o grupo (é sempre o mesmo). Cada amigo abre, entra com **nome e
   senha** e clica em **Abrir mesa online**.
5. **No fim:** feche a janela preta. A mesa sai da internet e o último backup do banco é feito.

| Situação | O que fazer |
|---|---|
| Amigo esqueceu a senha | Em **Jogadores**, gere o **link de retorno** dele. Ao abrir, ele define uma senha nova (e continua com a mesma conta e o mesmo personagem). **Não** mande um convite novo: isso criaria outra conta |
| Amigo novo | Gere um convite (seção 5) |
| Amigo mudou de celular | Nada: ele entra com nome e senha |
| Você esqueceu a sua senha | Na pasta `server`: `npm run dono` |
| "A mesa não abriu" | Veja a mensagem no painel; confira o Tailscale (ícone *Connected*) e tente de novo |
| Endereço não abre no celular | A mesa está aberta? Use os dados móveis para testar; confira se o computador não suspendeu |
| Backup não aparece | O "Meu Drive" está no Explorador? `npm run backup-drive` mostra o erro, se houver |

---

## 7. Atualizar o app

Quando houver uma versão nova no GitHub:

1. **Feche a mesa.**
2. No GitHub Desktop, **Fetch origin** e depois **Pull origin**.
3. Abra a mesa (`Iniciar mesa.cmd`). Ele recompila o app sozinho quando o código muda e atualiza o banco
   (com um backup automático antes, em `dados\backups\`). Os seus dados continuam onde estão.
