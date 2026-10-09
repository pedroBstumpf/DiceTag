# Boas práticas — Crônicas de Zehenia

Regras que o assistente de IA deve seguir em **toda** tarefa neste projeto. Elas complementam o
[`CLAUDE.md`](CLAUDE.md) (regras de negócio) e o [`ARCHITECTURE.md`](ARCHITECTURE.md) (estrutura).
Em caso de conflito entre uma regra daqui e um pedido, **avise antes de agir**.

---

## 1. Forma de trabalhar

- Faça **mudanças pequenas e focadas**: uma funcionalidade ou correção por vez. Evite diffs grandes
  que misturam assuntos.
- **Antes de alterar muitos arquivos**, apresente um plano curto e espere confirmação.
- **Explique o que mudou** ao final de cada tarefa: arquivos tocados, motivo e como testar.
- Se não entender um requisito, **pergunte** em vez de supor.
- Se uma correção falhar **2 ou 3 vezes seguidas**, pare de tentar. Descreva o erro, as hipóteses e
  o que foi tentado, e peça orientação.
- **Não invente APIs, pacotes ou opções.** Na dúvida sobre uma API do Angular, Material, CDK ou
  Tailwind, diga que não tem certeza e indique onde conferir na documentação oficial.
- Não remova nem reescreva código que não tem relação com a tarefa.

## 2. Git e comandos

- Trabalhe em **branch por funcionalidade**; não faça grandes mudanças direto na `main`.
- Sugira commits pequenos, com mensagens claras no padrão `tipo: descrição`
  (ex.: `feat: arrastar tokens entre camadas`, `fix: névoa não atualizava ao abrir porta`).
- **Nunca execute sem confirmação explícita**: `git push --force`, `git reset --hard`,
  `git clean`, `rm -rf`, exclusão de pastas, ou qualquer comando que apague dados ou histórico.
- Não altere o histórico do Git (rebase, squash, amend de commits já enviados) sem pedido.

## 3. Segurança e segredos

- **Nunca** escreva chaves de API, tokens, senhas ou credenciais no código, em comentários, em testes
  ou em mensagens de commit.
- Tudo que roda no navegador é **público**. Arquivos `src/environments/*.ts` e variáveis de build
  vão para o bundle: não coloque segredos neles.
- Serviços pagos ou privilegiados devem ser chamados **pelo back-end**, nunca direto do front-end.
- O `.gitignore` deve continuar cobrindo `.env`, `.env.*` (exceto `.env.example`), `node_modules`,
  `dist` e arquivos do sistema. Avise se encontrar algo sensível já versionado.
- Proibido usar `innerHTML`, `bypassSecurityTrust*`, `eval` ou `new Function` sem justificar o motivo
  e o risco. Conteúdo de texto rico (Tiptap) deve ser sanitizado ao exibir.
- Não guarde dados sensíveis em `localStorage`.
- Links externos com `target="_blank"` levam `rel="noopener noreferrer"`.

## 4. Dependências

- **Não instale pacotes novos sem perguntar.** Ao sugerir um, informe: para que serve, se é
  mantido, tamanho aproximado e se há alternativa sem dependência.
- Prefira resolver com o que o projeto já usa (Angular, Material, CDK, Tailwind).
- Desconfie de pacotes com nomes parecidos com os populares (typosquatting).
- Mantenha o lockfile commitado; não altere versões de dependências sem pedido.

## 5. Angular: convenções deste projeto

- **Angular 21, standalone e zoneless.** Não adicione `zone.js` nem `NgModule`.
- Estado com **signals** (`signal`, `computed`, `effect`, `input`, `output`, `model`). Use RxJS
  só quando houver um fluxo de eventos de fato.
- Componentes com `changeDetection: ChangeDetectionStrategy.OnPush`.
- Use `inject()` em vez de injeção pelo construtor.
- Templates com controle de fluxo nativo (`@if`, `@for` com `track`, `@switch`).
- **Effects**: use `untracked()` quando só devem reagir a um signal; registre `onCleanup` antes de
  qualquer `await` e confira cancelamento depois; dependa de `computed` estreitos para não
  disparar à toa.
- Toda página nova é **lazy** em `app.routes.ts`.

## 6. Arquitetura

- Respeite a regra de dependência: `features → shared → core`. **`core` nunca importa de `shared`,
  `layout` ou `features`.** Não crie novas exceções sem avisar.
- **Fonte única por domínio:** componentes não gravam no `StorageService` diretamente; chamam
  métodos do serviço dono dos dados.
- **Imutabilidade:** mutações sempre criam objetos novos; altere só a parte que mudou.
- **Lógica pura vai para `utils/`**, sem Angular, e sempre com `*.spec.ts`.
- **Novas mutações do `TableSessionService`** devem ser escritas como funções puras
  `(estado, dados) → novo estado`, em arquivos por assunto, e o serviço só as chama. Não aumente o
  serviço com lógica nova embutida.
- **Permissões** passam sempre por `sheetAccess` / `canEdit`; não espalhe regras de acesso pelos
  componentes.
- **Campos novos nos modelos são opcionais** e recebem valor padrão na função de normalização
  correspondente (`normalizeState`, `normalizeSheet` etc.). Nunca quebre dados já salvos.
- Novos acessos a dados devem ser pensados para virar **repositórios por domínio** (interface +
  implementação em IndexedDB fornecida por DI), facilitando a troca pelo back-end.
- Ao mudar a estrutura (pastas, serviços, rotas, fluxo de dados), **atualize o `ARCHITECTURE.md`**
  na mesma tarefa.

## 7. Interface e estilo

- Classes **Tailwind** nos templates; sem `.scss` por componente.
- Cores e espaçamentos vêm dos **tokens** de `src/styles/tailwind.css`. Não use valores soltos
  (cores hex, `px` arbitrários) quando houver token.
- Use **Angular Material** para botões, menus, diálogos, tooltips e snackbars, e **CDK** para
  arrastar/soltar e overlays. Não recrie o que eles já oferecem.
- Acessibilidade: elementos clicáveis são `button` ou `a`; ícones sozinhos têm `aria-label`;
  diálogos e menus funcionam pelo teclado.

## 8. Desempenho (VTT)

- Cálculos caros (visão, névoa, geometria) em `computed` com igualdade por valor, e redesenho
  agrupado em `requestAnimationFrame`.
- Não crie effects que recalculam a cada movimento do mouse sem necessidade.
- Libere *object URLs* e listeners ao destruir componentes.
- Não otimize sem medir; se propuser trocar SVG por canvas/WebGL, mostre o problema medido antes.

## 9. Dados e persistência

- Os dados do usuário vivem só no **IndexedDB** e podem ser perdidos. Qualquer mudança no formato
  salvo precisa de normalização compatível com o formato antigo.
- Nunca apague ou sobrescreva dados salvos em migrações sem aviso e sem forma de recuperar.
- Mantenha o `flush()` imediato em `pagehide` e na destruição da página.
- Não use dados pessoais reais em testes ou exemplos.

## 10. Testes e verificação antes de concluir

Antes de dar uma tarefa por concluída:

1. Rode os testes: `npx ng test --watch=false`.
2. Rode o lint e corrija os avisos introduzidos pela tarefa.
3. Confirme que o build passa: `npx ng build`.
4. Para lógica nova em `utils/` ou mutações puras, **escreva os testes junto**, incluindo casos de
   borda. Os testes devem falhar se a lógica estiver errada; não escreva testes que sempre passam.
5. Informe o que foi verificado e o que precisa de teste manual na tela.

## 11. Preparação para o back-end (multiplayer)

Ao trabalhar em qualquer coisa ligada a mesa, fichas, névoa ou rolagens, lembre que no futuro:

- **O servidor é a autoridade.** O navegador do jogador não é confiável.
- **Névoa e itens escondidos:** cada jogador deve receber só o que pode ver. Não crie recursos que
  dependam de o cliente ter o estado completo da mesa.
- **Rolagens de dados** que importam serão feitas no servidor; mantenha a lógica de `dice.ts` pura
  para poder rodar nos dois lados.
- **Permissões** serão reaplicadas no servidor; na tela elas só controlam a interface.
- Cada mutação deve poder ser descrita como um **comando** pequeno (ex.: mover token X para P), e
  não como "salvar a mesa inteira".

Se uma tarefa entrar em conflito com algum desses pontos, sinalize antes de implementar.
