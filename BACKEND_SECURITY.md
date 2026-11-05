# Segurança do back-end — Crônicas de Zehenia

Regras obrigatórias para qualquer código em `server/`. Complementam o
[`GOOD_PRACTICES.md`](GOOD_PRACTICES.md) e o [`ARCHITECTURE.md`](ARCHITECTURE.md).

**Stack de referência:** Node ≥ 22.13 + TypeScript 5.9 (executado com `tsx`) · Fastify 5 ·
`@fastify/cookie`, `cors`, `helmet`, `multipart`, `rate-limit` · `ws` 8 no mesmo servidor HTTP ·
`zod` 4 · SQLite via `node:sqlite` com SQL escrito à mão em `server/src/repositories/` ·
senhas com `scrypt` + pimenta do `node:crypto` · Vitest.

> Se uma tarefa exigir quebrar qualquer regra deste arquivo, **pare e explique o motivo e o risco
> antes de implementar**. Nunca desative ou enfraqueça uma proteção só para "fazer funcionar".

---

## 0. Princípios

1. **O servidor é a autoridade.** O cliente (navegador) pode ser modificado por qualquer jogador.
   Nada que chega do cliente é confiável: ids, papéis, posições, resultados de dados, permissões.
2. **Negar por padrão.** Toda rota e todo comando de WebSocket exigem autenticação e autorização,
   a menos que estejam numa lista explícita de exceções públicas.
3. **Mínimo de dados.** Só colete, guarde, envie e registre em log o que for necessário.
4. **Nunca invente criptografia.** Use apenas as primitivas do `node:crypto` descritas aqui.
5. **Falhe fechado.** Em caso de erro de autenticação, validação ou permissão, a resposta é negar.

### Código de domínio compartilhado com o front

`server/src/domain/index.ts` importa de `src/app` os comandos da mesa, as permissões, a rolagem e
as paredes. Isso evita regras duplicadas, mas traz responsabilidades:

- Os módulos importados devem ser **funções puras**: sem Angular, sem `window`, `document`,
  `localStorage` ou IndexedDB. Se um deles passar a importar algo do Angular, o servidor quebra ou,
  pior, passa a carregar código de UI.
- **Uma mudança no front pode mudar a segurança do servidor.** Toda alteração em permissões,
  comandos ou rolagem precisa rodar também os testes de `server/`.
- No servidor, as funções de permissão recebem o papel e o usuário **vindos do banco e da sessão**,
  nunca do cliente.

---

## 1. Senhas (`scrypt` + pimenta)

### Regras

- Use **`crypto.scrypt` assíncrono**, nunca `scryptSync` dentro de uma requisição: a versão síncrona
  trava o event loop e vira vetor de negação de serviço.
- **Sal único por usuário**: `randomBytes(16)` ou mais, gerado em cada cadastro e troca de senha.
- **Parâmetros mínimos** (recomendação OWASP para scrypt): `N = 2^17`, `r = 8`, `p = 1`, chave de
  64 bytes. Esse custo usa ~128 MB por cálculo, acima do `maxmem` padrão do Node (32 MB), então
  defina `maxmem` explicitamente.
- **Pimenta (pepper):** segredo do servidor que fica **fora do banco**, numa variável de ambiente.
  Aplique como `HMAC-SHA256(pimenta, senha)` antes do scrypt.
  - Guarde no hash o **id da versão da pimenta**, para permitir troca futura.
  - **Faça backup da pimenta separado do banco.** Perdê-la invalida todas as senhas.
- **Formato armazenado** autodescritivo, para permitir subir os parâmetros no futuro:
  `scrypt$<versãoPimenta>$N=131072,r=8,p=1$<sal base64>$<hash base64>`.
  No login, se os parâmetros estiverem desatualizados, recalcule e regrave o hash.
- **Compare com `timingSafeEqual`**, nunca com `===`.
- **Política de senha:** mínimo de 8 caracteres, máximo de 128 (validado no zod), sem exigir
  combinações artificiais de símbolos; aceite espaços e Unicode.
- **Login com resposta genérica:** "e-mail ou senha incorretos", com tempo semelhante quando o
  usuário não existe (calcule um hash falso nesse caso).
- O hash **nunca** sai do repositório de usuários: as consultas que alimentam respostas da API usam
  um tipo sem o campo de senha. Nunca registre senhas em log, nem em erro.

### Referência de implementação

```ts
import { createHmac, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const PARAMS = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 } satisfies ScryptOptions;
const KEYLEN = 64;

function scryptAsync(input: Buffer, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(input, salt, KEYLEN, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

function pepper(password: string, pepperSecret: Buffer): Buffer {
  return createHmac('sha256', pepperSecret).update(password.normalize('NFKC'), 'utf8').digest();
}

// Verificação: recalcula com o sal e os parâmetros salvos e compara em tempo constante.
function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
```

### Redefinição de senha (`AuthService.createPasswordReset` / `resetPassword`)

- Token aleatório de 32 bytes (`randomBytes(32)`), enviado ao usuário; no banco guarde **só o
  hash** do token (aqui, o HMAC-SHA256 de `TokenService`, como sessões e convites), com expiração
  curta (30–60 min) e uso único.
- O link usa o endereço da configuração (`PUBLIC_URL`), nunca o cabeçalho Host, e leva o token no
  fragmento da URL, que não vai ao servidor nem a logs.
- Ao redefinir, **invalide todas as sessões** do usuário.
- A resposta de "esqueci a senha" é a mesma exista ou não o e-mail.

---

## 2. Sessões e cookies (`@fastify/cookie`)

- Use **sessões opacas no banco**, não JWT: um id aleatório de 32 bytes (`randomBytes(32)`,
  base64url) vai no cookie; o banco guarda **só o SHA-256 desse id**, com `user_id`, `created_at`,
  `expires_at` e `last_seen_at`.
- Não guarde dados do usuário dentro do cookie.
- **Atributos obrigatórios do cookie em produção:**

  ```ts
  reply.setCookie('__Host-sid', sessionId, {
    httpOnly: true,   // inacessível ao JavaScript da página
    secure: true,     // só via HTTPS
    sameSite: 'lax',  // bloqueia envio na maioria dos pedidos de outros sites
    path: '/',        // obrigatório para o prefixo __Host-
    maxAge: 60 * 60 * 24 * 7,
  });
  ```

  Em desenvolvimento local (HTTP) use o nome sem o prefixo `__Host-` e `secure` condicionado a
  `NODE_ENV === 'production'`; nunca desative essas opções em produção.
- **Expiração dupla:** absoluta (ex.: 7–30 dias) e por inatividade (ex.: 24 h sem uso).
- **Gere um novo id de sessão** no login e em qualquer mudança de privilégio (evita fixação de sessão).
- **Logout apaga a sessão no banco**, não só o cookie. Ofereça "sair de todos os dispositivos".
- Ao apagar ou expirar uma sessão, **feche os WebSockets** abertos com ela.

### CSRF

Cookies são enviados automaticamente pelo navegador, então rotas que alteram dados precisam de
defesa contra CSRF:

- `SameSite=Lax` (acima) como primeira camada;
- **conferir o cabeçalho `Origin`** em todo `POST`/`PUT`/`PATCH`/`DELETE` contra a lista de origens
  permitidas, rejeitando com 403 se ausente ou diferente;
- aceitar corpo apenas como `application/json` (e `multipart/form-data` só nas rotas de upload).

Nunca use `GET` para ações que alteram dados.

---

## 3. Autorização nas rotas HTTP

- Registre um **hook global (`onRequest`/`preHandler`) que exige sessão válida** e coloca o usuário
  em `request.user`. Rotas públicas (login, entrar por convite, saúde) ficam numa lista explícita.
- **Todo id recebido do cliente é verificado contra o usuário da sessão** (proteção contra IDOR,
  a falha mais comum em apps feitos com IA). Faça a checagem **na própria consulta SQL**:

  ```sql
  SELECT t.* FROM tables t
  JOIN table_members m ON m.table_id = t.id
  WHERE t.id = ? AND m.user_id = ?
  ```

- Para recursos de outros usuários, responda **404** (não 403), para não revelar que existem.
- O **papel na mesa (mestre/jogador) vem da tabela de membros**, nunca do corpo da requisição.
- Ids devem ser **imprevisíveis** (`crypto.randomUUID()`). Confira que `newId()` não usa
  `Math.random`.
- Ações administrativas ou da "Lore geral" exigem verificação explícita de quem pode editar.

---

## 4. WebSocket (`ws`)

O WebSocket é a superfície de ataque mais sensível de um VTT. Regras:

### 4.1 Conexão

- **Valide `Origin` no upgrade** contra a lista de origens permitidas. Navegadores enviam cookies
  em WebSockets abertos por outros sites (*cross-site WebSocket hijacking*), e o CORS **não** se
  aplica a WebSockets.
- **Autentique no upgrade**, lendo o cookie de sessão, e recuse antes de aceitar a conexão:

  ```ts
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  app.server.on('upgrade', (req, socket, head) => {
    if (!ALLOWED_ORIGINS.has(req.headers.origin ?? '')) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      return socket.destroy();
    }
    const user = sessionFromCookieHeader(req.headers.cookie);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, user));
  });
  ```

- **Defina `maxPayload`** (o padrão do `ws` é 100 MiB). Comandos de mesa cabem em poucos KB.
- **Limite conexões simultâneas por usuário** e use ping/pong periódico para derrubar conexões mortas.

### 4.2 Mensagens

- **Toda mensagem é validada com zod** (união discriminada por `type`, objetos estritos). Mensagem
  inválida é descartada e contada; muitas inválidas encerram a conexão.
- **O `userId` vem sempre da conexão autenticada**, nunca do conteúdo da mensagem.
- **Cada comando passa pelas funções de permissão** do domínio com o papel lido do banco, antes de
  alterar o estado.
- **Rate limit por conexão** (ex.: balde de fichas com N mensagens/segundo). O `@fastify/rate-limit`
  não cobre mensagens de WebSocket.
- Erros enviados ao cliente são genéricos; detalhes vão só para o log.

### 4.3 O que cada jogador recebe

- **Nunca transmita o `TableState` completo a jogadores.** Crie uma função pura de projeção
  `visaoDoJogador(estado, usuário, papel)` que remove:
  - tokens escondidos e o que está sob a névoa para aquele jogador;
  - notas, camadas e itens visíveis só ao mestre;
  - fichas que o jogador não tem permissão de ver (`sheetAccess`).
- Toda difusão (*broadcast*) passa por essa projeção, **por destinatário**.
- Essa função tem testes próprios cobrindo cada tipo de informação escondida.

### 4.4 Rolagens de dados

- Rolagens que afetam o jogo são feitas **no servidor**, com `crypto.randomInt`, nunca com
  `Math.random`. O resultado enviado pelo cliente é ignorado.
- `dice.ts` (compartilhado) deve receber o gerador de números aleatórios como parâmetro, para o
  front e o servidor usarem fontes diferentes.

---

## 5. Validação de entrada (`zod`)

- **Todas as rotas validam `body`, `params` e `querystring`** com zod antes de qualquer lógica.
- Use **objetos estritos** (`z.strictObject`) para rejeitar campos desconhecidos.
- **Toda string tem tamanho máximo**, todo array tem quantidade máxima, todo número é finito e tem
  faixa (coordenadas, níveis, quantidades). Valores sem limite viram negação de serviço.
- Configure o **`bodyLimit`** do Fastify (padrão 1 MB; reduza onde puder).
- **Respostas também são filtradas:** monte o objeto de saída com os campos permitidos; nunca devolva
  a linha do banco inteira nem use `...spread` de dados do usuário.
- Não use `Object.assign`/merge profundo com dados vindos do cliente (poluição de protótipo).
- **O `.env` é validado com zod na inicialização**; se faltar ou estiver inválido, o servidor não sobe.

---

## 6. Banco de dados (`node:sqlite`)

### Consultas

- **Sempre instruções preparadas com placeholders:**

  ```ts
  db.prepare('SELECT id, name FROM tables WHERE id = ? AND owner_id = ?').get(tableId, userId);
  ```

  **Proibido** montar SQL com template strings ou concatenação de valores do usuário.
- Partes dinâmicas que não aceitam placeholder (nome de coluna em `ORDER BY`, direção) só podem vir
  de uma **lista fixa** no código.
- Todo SQL fica em `server/src/repositories/`; nenhum outro lugar acessa o banco.
- Escritas em várias tabelas usam **transação** (`BEGIN` / `COMMIT` / `ROLLBACK`).

### Configuração

- Ao abrir o banco:

  ```ts
  db.exec(`
    PRAGMA foreign_keys = ON;   -- no SQLite vem DESLIGADO por padrão
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
  `);
  ```

- O `node:sqlite` é **síncrono**: uma consulta lenta trava todas as requisições e WebSockets. Mantenha
  consultas indexadas e pequenas, e pagine listas.
- O `node:sqlite` ainda é marcado como experimental na documentação do Node 22. Confira o status na
  versão usada e fixe a versão do Node em produção.

### Arquivos e migrações

- O arquivo do banco fica **fora de qualquer pasta servida publicamente**, com permissão restrita ao
  usuário do processo (ex.: `chmod 600`).
- O `.gitignore` cobre `*.db`, `*.db-wal`, `*.db-shm` e a pasta de uploads.
- **Migrações versionadas e só para frente**, registradas numa tabela `schema_migrations`, cada uma
  dentro de uma transação. **Nunca edite uma migração já aplicada**; crie outra.
- **Backup antes de migrar** em produção.
- A IA **nunca** executa comandos ou migrações contra o banco de produção.

---

## 7. Criptografia e proteção de dados

- **Fontes de aleatoriedade permitidas:** `randomBytes`, `randomUUID`, `randomInt` do `node:crypto`.
  `Math.random` é proibido para qualquer coisa ligada a segurança, ids ou rolagens.
- **Algoritmos permitidos:**
  - senhas: `scrypt` (seção 1);
  - tokens e ids de sessão guardados no banco: `SHA-256`;
  - assinaturas/integridade: `HMAC-SHA256`;
  - cifrar um campo, se um dia for necessário: `AES-256-GCM`, com IV aleatório de 12 bytes **novo a
    cada cifragem**, guardando IV e tag de autenticação junto do texto cifrado.
- **Proibido:** MD5 ou SHA-1 para qualquer fim de segurança, modo ECB, IV fixo ou reutilizado,
  "criptografia" caseira (XOR, base64, embaralhamento).
- **Dados em trânsito:** HTTPS obrigatório em produção (TLS no proxy reverso ou na hospedagem) e
  `wss://` para o WebSocket. HSTS ativado pelo `helmet`.
- **Dados em repouso:** o SQLite não cifra o arquivo. A proteção vem de disco cifrado no servidor e
  backups cifrados. A melhor defesa é **não guardar** o que não é necessário.
- Configure **`trustProxy`** do Fastify de acordo com a hospedagem; sem isso, IPs, `Secure` e rate
  limit funcionam errado atrás de proxy.

---

## 8. Uploads (`@fastify/multipart`)

Mapas, imagens de token e áudios são o principal vetor de abuso de armazenamento e de conteúdo
malicioso.

- **Limites explícitos:** `fileSize`, `files`, `fields`, `parts`, por tipo de rota.
- **Lista de tipos permitidos**, checando a extensão, o MIME declarado **e os primeiros bytes do
  arquivo** (assinatura de PNG, JPEG, WebP, MP3, OGG). O MIME enviado pelo cliente sozinho não vale.
- **SVG enviado por usuário é bloqueado** (pode conter scripts). Se for indispensável, só com
  sanitização robusta, decidida antes com o responsável.
- **O nome do arquivo no disco é gerado pelo servidor** (`randomUUID()`); o nome original é só
  metadado. Nunca use o nome do cliente para montar caminhos (*path traversal*).
- Grave em **streaming** para o disco, sem carregar o arquivo inteiro na memória.
- Arquivos ficam **fora da pasta pública** e são servidos por uma rota que **verifica se o usuário é
  membro da mesa** dona do arquivo.
- Ao servir: `Content-Type` correto, `X-Content-Type-Options: nosniff`, e
  `Content-Disposition: attachment` para tudo que não for imagem ou áudio exibido na mesa.
- **Cota por usuário e por mesa** (tamanho total).
- Fotos podem ter metadados com localização (EXIF). Antes de aceitar fotos pessoais, discuta remover
  esses metadados.

---

### Biblioteca do dono (`LIBRARY_DIR`)

- Todo caminho vindo do navegador passa por `security/library-path.ts`; nenhuma outra parte monta caminhos dela.
- Atalhos (links e junções) não são seguidos, e a parte existente do caminho, resolvida, precisa estar dentro da raiz.
- Arquivos da biblioteca nunca vão aos jogadores: só cópias enviadas à mesa, sem metadados.
- `--permission` do Node (`npm run mesa`) é a segunda camada: não relaxe `sandboxArgs` sem explicar o motivo e o risco, e nunca dê
  `--allow-child-process` ao servidor exposto. O que precisa executar algo pertence a `scripts/mesa.ts`, com operações fixas.

---

## 9. Cabeçalhos e CORS (`@fastify/helmet`, `@fastify/cors`)

- **CORS com lista explícita de origens**, lida do `.env` e comparada de forma exata.
  **Proibido** `origin: true`, `'*'` ou expressões regulares frouxas junto com `credentials: true`.
- Libere só os métodos e cabeçalhos usados.
- **Helmet ativo em todas as respostas**, com Content-Security-Policy definida explicitamente.
  Se o servidor também entregar o app Angular, a CSP deve permitir só as origens realmente usadas
  (ex.: Google Fonts) e bloquear scripts inline.
- **Erros de CORS ou CSP se corrigem ajustando a origem permitida certa**, nunca liberando tudo.

---

## 10. Rate limit e negação de serviço

- **Limite global moderado** por IP com `@fastify/rate-limit`.
- **Limites rígidos** em login, convites e redefinição de senha: por IP **e** por conta
  (ex.: 5 tentativas por minuto), com atraso crescente em vez de bloqueio permanente da conta.
- Limites próprios para uploads e criação de mesas.
- WebSocket: `maxPayload`, rate limit por conexão e máximo de conexões por usuário (seção 4).
- Defina `connectionTimeout` e `requestTimeout` no Fastify.
- Lembre que o `scrypt` é caro de propósito: sem rate limit, o login vira forma de derrubar o servidor.

---

## 11. Segredos e configuração

- `.env` **nunca** é commitado; mantenha um `.env.example` com os nomes e sem valores reais.
- Segredos (pimenta, chaves de cookie, outros) com **pelo menos 32 bytes aleatórios**:
  `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`.
- **Segredos diferentes para desenvolvimento e produção.** Os de produção ficam só no painel da
  hospedagem ou num gerenciador de segredos.
- Nunca registre `process.env` em log nem o envie em respostas de erro.
- Documente como **trocar** cada segredo (rotação) e o efeito disso (ex.: trocar a pimenta exige a
  estratégia de versões da seção 1).

---

## 12. Logs e erros

- Use o logger do Fastify (pino) com **`redact`** para: `req.headers.cookie`,
  `req.headers.authorization`, `res.headers["set-cookie"]` e qualquer `password`, `token` ou `pepper`
  em corpos.
- **Handler de erro global:** em produção, o cliente recebe só uma mensagem genérica e um id da
  requisição; stack trace e detalhes ficam no log.
- **Registre eventos de segurança:** login com sucesso e falha, troca de senha, sessão encerrada,
  permissão negada, rate limit atingido, upload rejeitado, mensagens de WebSocket inválidas.
- Logs **não contêm** senhas, tokens, ids de sessão completos nem dados pessoais desnecessários.
- Defina por quanto tempo os logs são guardados.

---

## 13. Dependências e execução

- O back-end tem poucas dependências, e isso é uma vantagem: **não adicione pacotes sem perguntar**,
  sobretudo em autenticação e criptografia.
- Use `npm ci` com lockfile commitado; rode `npm audit` antes de cada deploy.
- Mantenha o Node numa versão LTS com as atualizações de segurança aplicadas.
- Em produção, fixe a versão do `tsx` (ou avalie rodar com o suporte nativo a TypeScript do Node,
  se a versão usada oferecer). Não rode com `--inspect` em produção.
- O processo roda com um **usuário sem privilégios de administrador**.
- `NODE_ENV=production` em produção.

---

## 14. Privacidade e LGPD

- **Colete o mínimo:** e-mail, nome de exibição e senha. Não peça documento, telefone ou data de
  nascimento sem necessidade real.
- Tenha **política de privacidade** explicando o que é guardado e por quê.
- Ofereça **exportar os dados** do usuário e **excluir a conta**, removendo em cascata mesas próprias,
  fichas, worldbuild e arquivos enviados. Documente quanto tempo os dados permanecem nos backups.
- Dados pessoais **nunca em URLs** (aparecem em logs e históricos).
- Tenha um **plano de incidente**: como detectar, conter, avisar os usuários afetados e, quando
  exigido pela LGPD, comunicar a ANPD. Na dúvida sobre obrigações legais, consulte um profissional.

---

## 15. Backups

- Backup automático do banco **e da pasta de uploads**.
- Para o SQLite em funcionamento, use `VACUUM INTO 'caminho/backup.db'` (cópia consistente). Não
  copie o arquivo `.db` sozinho enquanto o servidor roda em modo WAL.
- Backups **cifrados**, guardados **fora do servidor** principal.
- **Teste a restauração** periodicamente. Backup nunca restaurado não é garantia.
- A pimenta e os demais segredos têm backup **separado** do banco.

---

## 16. Testes de segurança (Vitest)

Toda funcionalidade do back-end chega com testes. Cobertura mínima de segurança:

- rota protegida sem sessão → **401**;
- usuário A tentando ler, alterar ou apagar mesa, ficha ou arquivo do usuário B → **404** (IDOR);
- jogador tentando comando exclusivo do mestre → rejeitado;
- `visaoDoJogador` não contém tokens escondidos, áreas sob névoa, notas do mestre nem fichas sem
  permissão;
- payloads inválidos, com campos extras ou acima dos limites → rejeitados pelo zod;
- senha: hash e verificação corretos, senha errada falha, mesmo hash nunca se repete (sal);
- cookie de sessão com `HttpOnly`, `Secure` (produção), `SameSite` e expiração;
- requisição com `Origin` não permitido → rejeitada (HTTP e upgrade do WebSocket);
- upgrade do WebSocket sem cookie válido → recusado;
- upload com tipo proibido, SVG, assinatura falsa ou acima do limite → rejeitado;
- rate limit do login atinge o limite;
- rolagem do servidor ignora resultado enviado pelo cliente.

---

## 17. Regras de conduta para a IA neste back-end

- Mudanças em **autenticação, sessões, senhas, criptografia, permissões, CORS, CSP, uploads ou
  WebSocket** exigem: explicação do que muda, avaliação de risco e testes junto.
- **Nunca** desative `helmet`, `rate-limit`, validação zod ou checagem de permissão para contornar
  um erro.
- **Nunca** crie rota ou comando novo sem autenticação, autorização e validação.
- **Nunca** use `Math.random`, `scryptSync` em requisições, SQL concatenado ou `origin: '*'`.
- **Nunca** acesse, migre ou altere o banco de produção.
- Ao terminar uma tarefa no back-end, rode os testes do `server/` **e** os do front (por causa do
  domínio compartilhado) e informe o resultado.

---

## Checklist antes de publicar

- [ ] HTTPS e `wss://` ativos; HSTS ligado
- [ ] `NODE_ENV=production`, `trustProxy` configurado
- [ ] Segredos de produção gerados, fora do Git, com backup separado
- [ ] Cookies com `__Host-`, `HttpOnly`, `Secure`, `SameSite`
- [ ] CORS e `Origin` do WebSocket com a lista exata de domínios de produção
- [ ] Rate limits ativos (global, login, uploads, WebSocket)
- [ ] `PRAGMA foreign_keys = ON` confirmado
- [ ] Banco e uploads fora da pasta pública, com permissões restritas
- [ ] Backup automático configurado e **uma restauração testada**
- [ ] `npm audit` sem vulnerabilidades altas ou críticas
- [ ] Todos os testes de segurança da seção 16 passando
- [ ] Política de privacidade publicada; exclusão de conta funcionando
