# Histórico de versões

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); versões em
[SemVer](https://semver.org/lang/pt-BR/). Enquanto o projeto estiver em `0.x`, uma versão "menor"
pode trazer mudanças incompatíveis. Como versionar e organizar as branches: `README.md`, seção
"Versões e branches".

## [Não publicado]

## [0.4.0] — 2026-11-05

O app passa a ser só por convite e a rodar no computador de quem o possui.

### Adicionado
- **`npm run mesa` e `Iniciar mesa.cmd`:** iniciam tudo com um comando. O botão **Abrir para os jogadores** coloca a mesa na internet pelo
  Tailscale Funnel, sem abrir portas, e fechar a janela a tira de lá.
- **Convites:** link de uso único; o amigo entra só com um nome, sem cadastro nem senha. Link de retorno para quem troca de aparelho.
- **Arquivos:** biblioteca de imagens e sons, em pastas, numa pasta real do computador; também pelo Explorador do Windows, e
  disponível na mesa para mapas, sons e imagens de ficha.
- `npm run dono`: cria o dono ou troca os dados dele, inclusive a senha.

### Mudado
- **Sem cadastro.** Só o dono entra com senha e cria mesas e mundos. Sem conta, tudo leva à página de entrada.
- O que é do dono fica em `Documentos\Cronicas de Zehenia`, fora do repositório.

### Segurança
- O servidor roda isolado pelo modelo de permissões do Node: não lê nem grava fora da pasta do app e não executa programas.
- Abrir e fechar a mesa só valem do próprio computador, mesmo com a senha do dono.
- Caminhos da biblioteca conferidos contra saída da pasta, inclusive por atalhos.
- Limites menores de envio para convidados.

### Corrigido
- "Vincular à minha conta" e "é meu" na ficha comparavam com a conta local: não funcionavam na mesa online.

## [0.3.0] — 2026-11-04

A mesa online passa a funcionar de verdade entre duas máquinas.

### Adicionado
- **Worldbuild e bestiário no servidor:** a Lore, as raças, os itens e os NPCs da mesa online vêm do servidor. O jogador
  recebe só o que pode ver. Minhas mesas ganhou "Preparar o mundo da mesa" e "Enviar … deste navegador".
- **Tempo real:** pings, efeitos e sons aparecem para todos; quem chega depois entra no ponto certo da música; cada máquina
  tem o próprio volume.
- **Recuperação de senha** da conta do servidor, por e-mail ou por `npm run reset-link`.
- `npm run e2e`: teste com dois navegadores reais na mesma mesa.

### Corrigido
- Item largado pelo jogador no mapa se perdia; comprar, lootear e pegar do chão podiam falhar ou duplicar itens. Agora cada
  operação é um comando só, com preço e estoque conferidos pelo servidor.
- Rolagens online somam itens equipados, treinam estudos e usam a ficha dos NPCs do bestiário; o "Rolar" gasta Espírito.
- A ficha de outro jogador aparecia como editável, e o servidor recusava cada alteração.
- Mexer no controle de volume podia estourar o limite de mensagens e derrubar a conexão.

### Segurança
- Imagens enviadas ao servidor saem sem metadados (EXIF, localização).
- O nome de um efeito agora é conferido pelo servidor antes de ser repassado aos outros jogadores.

### Desempenho
- Pacote inicial de 847 kB para 682 kB: os diálogos de conta e de nova mesa carregam só quando abertos.

## [0.2.0] — 2026-11-04

### Adicionado
- Servidor (`server/`): API HTTP, sala da mesa por WebSocket, SQLite, contas e convites reais,
  visão calculada no servidor, rolagens no servidor, LGPD e backup.
- Mesa online: conta do servidor, mesas com convites e a mesa de jogo ligada à sala.
- Arquivos da mesa online guardados no servidor.
- O servidor entrega o app compilado (um processo só, sem o `ng serve`).

### Segurança
- `.env` e bancos cobertos também pelo `.gitignore` da raiz: uma branch sem `server/.gitignore`
  não pode mais enviar os segredos por engano.
- Dependência `fast-uri` atualizada (alertas moderados do `npm audit`).

### Corrigido
- `tsx`, que executa o servidor, passou para as dependências de produção: `npm ci --omit=dev` não
  quebra mais o `npm start`.

## [0.1.0] — 2026-10-09

### Adicionado
- MVP de interface, com tudo salvo no navegador (IndexedDB): landing, mundos, Worldbuild, mesas,
  mesa de jogo (mapa em camadas, vista isométrica, névoa, tokens, desenhos, efeitos), fichas de
  personagem e NPC, automações, rolagens, chat e sons.

[Não publicado]: https://github.com/pedroBStumpf/DiceTag/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/pedroBStumpf/DiceTag/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/pedroBStumpf/DiceTag/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/pedroBStumpf/DiceTag/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/pedroBStumpf/DiceTag/releases/tag/v0.1.0
