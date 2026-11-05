import type { Config } from './config/env';
import type { Db } from './db/database';
import { FilesRepository } from './repositories/files';
import { PasswordResetsRepository } from './repositories/password-resets';
import { SessionsRepository } from './repositories/sessions';
import { TablesRepository } from './repositories/tables';
import { UsersRepository } from './repositories/users';
import { WorldsRepository } from './repositories/worlds';
import { PasswordHasher } from './security/password';
import { TokenService } from './security/tokens';
import { AuthService } from './services/auth.service';
import { NO_HOST_CONTROL, ipcHostControl, type HostControl } from './services/host-control';
import { LibraryService } from './services/library.service';
import { createMailer, type Mailer } from './services/mailer';

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
  mailer: Mailer;
  library: LibraryService;
  /** Abrir a mesa aos jogadores: só existe com `npm run mesa`. */
  host: HostControl;
}

export function createContext(config: Config, db: Db): AppContext {
  const users = new UsersRepository(db);
  const sessions = new SessionsRepository(db);
  const worlds = new WorldsRepository(db);
  const tokens = new TokenService(config.TOKEN_SECRET);
  const hasher = new PasswordHasher(config.peppers, config.PASSWORD_COST);
  const resets = new PasswordResetsRepository(db);
  return {
    config,
    db,
    users,
    worlds,
    tables: new TablesRepository(db),
    files: new FilesRepository(db, config.FILES_DIR),
    tokens,
    auth: new AuthService(db, users, sessions, worlds, hasher, tokens, config, resets),
    mailer: createMailer(config),
    library: new LibraryService(config.LIBRARY_DIR),
    host: process.send && process.env['ZEHENIA_MESA'] ? ipcHostControl(process.send.bind(process)) : NO_HOST_CONTROL,
  };
}
