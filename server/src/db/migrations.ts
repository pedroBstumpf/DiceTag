/**
 * Migrações do banco, em ordem. Nunca altere uma migração já publicada: acrescente outra
 * no fim da lista (o banco registra as aplicadas em `schema_migrations`; ver `database.ts`).
 *
 * Datas em milissegundos (como o front-end). Ids gerados no servidor (`newId`).
 */
export const MIGRATIONS: readonly string[] = [
  // 1 — contas, sessões, mundos, mesas, convites, estado das mesas e arquivos
  `
  CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  ) STRICT;

  -- Sessão: só o HMAC do token fica no banco (vazar o banco não entrega sessões válidas)
  CREATE TABLE sessions (
    token_hash   TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE worlds (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX worlds_owner ON worlds(owner_id);

  -- Itens do Worldbuild (pastas, documentos, NPCs…) como JSON validado na entrada
  CREATE TABLE world_items (
    world_id   TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    id         TEXT NOT NULL,
    data       TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (world_id, id)
  ) STRICT;

  CREATE TABLE game_tables (
    id          TEXT PRIMARY KEY,
    owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    world_id    TEXT NOT NULL REFERENCES worlds(id) ON DELETE RESTRICT,
    name        TEXT NOT NULL,
    system      TEXT NOT NULL,
    description TEXT NOT NULL,
    max_players INTEGER NOT NULL,
    accent      TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX game_tables_world ON game_tables(world_id);

  -- Papel vem da conta: o dono é o mestre; quem entra por convite é jogador
  CREATE TABLE table_members (
    table_id  TEXT NOT NULL REFERENCES game_tables(id) ON DELETE CASCADE,
    user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role      TEXT NOT NULL CHECK (role IN ('gm', 'player')),
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (table_id, user_id)
  ) STRICT;
  CREATE INDEX table_members_user ON table_members(user_id);

  -- Convite: só o HMAC do código fica no banco
  CREATE TABLE table_invites (
    code_hash  TEXT PRIMARY KEY,
    table_id   TEXT NOT NULL REFERENCES game_tables(id) ON DELETE CASCADE,
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    max_uses   INTEGER NOT NULL,
    uses       INTEGER NOT NULL DEFAULT 0
  ) STRICT;
  CREATE INDEX table_invites_table ON table_invites(table_id);

  -- Estado da mesa (snapshot) + versão que só cresce (um a cada comando aceito)
  CREATE TABLE table_states (
    table_id   TEXT PRIMARY KEY REFERENCES game_tables(id) ON DELETE CASCADE,
    state      TEXT NOT NULL,
    version    INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;

  -- Arquivos enviados (o conteúdo fica em disco, em FILES_DIR/<id>)
  CREATE TABLE files (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    table_id   TEXT REFERENCES game_tables(id) ON DELETE SET NULL,
    world_id   TEXT REFERENCES worlds(id) ON DELETE SET NULL,
    mime       TEXT NOT NULL,
    size       INTEGER NOT NULL,
    sha256     TEXT NOT NULL,
    created_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX files_owner ON files(owner_id);
  CREATE INDEX files_table ON files(table_id);
  CREATE INDEX files_world ON files(world_id);
  `,
  // 2 — recuperação de senha: só o HMAC do token fica no banco, com prazo curto
  `
  CREATE TABLE password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX password_resets_user ON password_resets(user_id);
  `,
];
