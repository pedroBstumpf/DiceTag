# Histórico de versões

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); versões em
[SemVer](https://semver.org/lang/pt-BR/). Enquanto o projeto estiver em `0.x`, uma versão "menor"
pode trazer mudanças incompatíveis. Como versionar e organizar as branches: `README.md`, seção
"Versões e branches".

## [Não publicado]

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

[Não publicado]: https://github.com/pedroBStumpf/DiceTag/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/pedroBStumpf/DiceTag/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/pedroBStumpf/DiceTag/releases/tag/v0.1.0
