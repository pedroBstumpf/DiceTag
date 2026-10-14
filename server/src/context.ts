import type { Config } from './config/env';
import type { Db } from './db/database';
import { FilesRepository } from './repositories/files';
import { SessionsRepository } from './repositories/sessions';
import { TablesRepository } from './repositories/tables';
import { UsersRepository } from './repositories/users';
import { WorldsRepository } from './repositories/worlds';
import { PasswordHasher } from './security/password';
import { TokenService } from './security/tokens';
import { AuthService } from './services/auth.service';

/**
 * Dependências do servidor montadas num lugar só (injeção manual, sem framework de DI).
 * Rotas HTTP e a sala do WebSocket recebem este contexto; os testes montam um com banco em memória.
 */
export interface AppContext {
  config: Config;
  db: Db;
  users: UsersRepository;
  worlds: WorldsRepository;
  tables: TablesRepository;
  files: FilesRepository;
  tokens: TokenService;
  auth: AuthService;
}

export function createContext(config: Config, db: Db): AppContext {
  const users = new UsersRepository(db);
  const sessions = new SessionsRepository(db);
  const worlds = new WorldsRepository(db);
  const tokens = new TokenService(config.TOKEN_SECRET);
  const hasher = new PasswordHasher(config.PASSWORD_PEPPER, config.PASSWORD_COST);
  return {
    config,
    db,
    users,
    worlds,
    tables: new TablesRepository(db),
    files: new FilesRepository(db, config.FILES_DIR),
    tokens,
    auth: new AuthService(db, users, sessions, worlds, hasher, tokens, config),
  };
}
