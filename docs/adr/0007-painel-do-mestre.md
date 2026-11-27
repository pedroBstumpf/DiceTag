# ADR-0007: Painel do Mestre — uma tela para convidar, criar e gerenciar mesas

- **Status:** Aceito
- **Data:** 2026-11-27
- **Decisores:** @pedroBstumpf

## Contexto

O dono quer "uma tela do app destinada ao GM, capaz de convidar novos usuários, criar mesas, ver as informações de
cada mesa e editar basicamente tudo, sendo ele o Mestre do Jogo". Hoje essas ações existem, mas espalhadas: criar e
convidar em **Minhas mesas → Mesas online**, abrir para os jogadores no `HostPanel`, preparar o mundo no Worldbuild,
editar a mesa (nome, sistema, descrição, limite, cor) só pela API (`PATCH /tables/:id` não tem tela).

No modelo atual, **o dono do app é o Mestre** de todas as mesas que cria (`users.kind = owner`, papel `gm`), e só ele
cria mesas e mundos (`requireOwner`).

## Opções consideradas

1. **Novo papel "admin" separado do Mestre** — mais flexível, mas o app tem um dono só (índice `users_one_owner`);
   seria complexidade sem uso.
2. **Painel do Mestre como tela do dono**, sobre as mesmas rotas protegidas, mais um endpoint de resumo. Escolhida.

## Decisão

- Rota **`/mestre`** (Shell, lazy, `ownerGuard`) com o "Painel do Mestre": abrir para os jogadores (o `HostPanel`
  existente), criar mesa, e por mesa: informações, editar dados, gerar convite, jogadores (link de retorno, tirar da
  mesa), cancelar convites pendentes, preparar o mundo, abrir a mesa e excluir.
- Novo endpoint **`GET /api/gm/overview`** (`requireOwner`): por mesa do dono, número de jogadores, convites
  pendentes, cenas, se a sala está aberta e quantas pessoas estão nela, e a data da última alteração. Só contagens:
  nenhum conteúdo de ficha, chat ou mapa.
- **A autorização continua no servidor**: o painel não ganha nenhum poder novo — cada botão chama a rota que já
  exige o papel `gm`/dono. Guard no front é só UX.
- "Editar basicamente tudo" **dentro** da mesa continua sendo a própria mesa de jogo e o Worldbuild (o Mestre já pode
  tudo lá); o painel leva até eles em um clique.

## Consequências

- Uma porta de entrada única para o Mestre; "Minhas mesas" continua existindo para os jogadores e para as mesas locais.
- O endpoint de resumo é novo código no servidor: exige teste de 401 (sem conta), 403 (convidado) e de que só
  aparecem as mesas do dono.
- Ações destrutivas no painel pedem confirmação nomeando a mesa (doc 01 §13).
