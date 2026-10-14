import type { Config } from '../config/env';
import { transaction, type Db } from '../db/database';
import { HttpError, badRequest, conflict } from '../lib/errors';
import { newId } from '../lib/ids';
import { WindowLimiter } from '../lib/limiter';
import type { SessionsRepository } from '../repositories/sessions';
import type { PublicUser, UsersRepository } from '../repositories/users';
import type { WorldsRepository } from '../repositories/worlds';
import { passwordProblem, type PasswordHasher } from '../security/password';
import type { TokenService } from '../security/tokens';

/** Sessão válida: a conta e o hash do token (para encerrar esta sessão). */
export interface AuthSession {
  user: PublicUser;
  tokenHash: string;
}

/** Nome do primeiro mundo criado com a conta (igual ao do front-end). */
const FIRST_WORLD_NAME = 'Meu mundo';
/** Gravar "visto por último" no máximo a cada 5 minutos (evita uma escrita por requisição). */
const TOUCH_EVERY_MS = 5 * 60_000;

/**
 * Contas e sessões: cadastro, login, logout, troca de senha e validação do token de sessão.
 *
 * - Login com mensagem única para e-mail inexistente e senha errada, e o mesmo tempo de
 *   resposta nos dois casos (`dummyVerify`): não dá para descobrir quais e-mails têm conta.
 * - Falhas de login por e-mail: 5 a cada 15 minutos; depois, bloqueio temporário daquele e-mail
 *   (contra adivinhação de senha distribuída em vários IPs).
 * - Sessão nova a cada login (o token antigo não é reaproveitado: sem fixação de sessão).
 * - Trocar a senha encerra as outras sessões da conta.
 */
export class AuthService {
  private readonly failures: WindowLimiter;

  constructor(
    private readonly db: Db,
    private readonly users: UsersRepository,
    private readonly sessions: SessionsRepository,
    private readonly worlds: WorldsRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
    private readonly config: Config,
    private readonly now: () => number = Date.now,
  ) {
    this.failures = new WindowLimiter(5, 15 * 60_000, now);
  }

  // --- Cadastro e login --------------------------------------------------------

  async register(input: { name: string; email: string; password: string }): Promise<{ user: PublicUser; token: string }> {
    const problem = passwordProblem(input.password, input.email);
    if (problem) throw badRequest(problem);
    // Hash antes da transação (é lento e não precisa segurar o banco)
    const passwordHash = await this.hasher.hash(input.password);
    const now = this.now();
    const user: PublicUser = { id: newId(), name: input.name, email: input.email, createdAt: now };
    transaction(this.db, () => {
      if (this.users.emailTaken(input.email)) throw conflict('Não foi possível criar a conta com esse e-mail.');
      this.users.create({ ...user, passwordHash });
      this.worlds.create({ id: newId(), ownerId: user.id, name: FIRST_WORLD_NAME, createdAt: now });
    });
    return { user, token: this.openSession(user.id) };
  }

  async login(email: string, password: string): Promise<{ user: PublicUser; token: string }> {
    if (this.failures.blocked(email)) {
      throw new HttpError(429, 'Muitas tentativas para este e-mail. Tente novamente em alguns minutos.');
    }
    const found = this.users.credentialsByEmail(email);
    const ok = found ? await this.hasher.verify(password, found.passwordHash) : (await this.hasher.dummyVerify(password), false);
    if (!found || !ok) {
      this.failures.hit(email);
      throw new HttpError(401, 'E-mail ou senha inválidos.');
    }
    this.failures.reset(email);
    // Custo do hash mudou desde o cadastro: refaz agora que temos a senha
    if (this.hasher.needsRehash(found.passwordHash)) this.users.setPasswordHash(found.user.id, await this.hasher.hash(password));
    return { user: found.user, token: this.openSession(found.user.id) };
  }

  logout(token: string): void {
    this.sessions.delete(this.tokens.hash(token, 'session'));
  }

  async changePassword(session: AuthSession, current: string, next: string): Promise<void> {
    const stored = this.users.passwordHashOf(session.user.id);
    if (!stored || !(await this.hasher.verify(current, stored))) throw new HttpError(401, 'Senha atual incorreta.');
    const problem = passwordProblem(next, session.user.email);
    if (problem) throw badRequest(problem);
    this.users.setPasswordHash(session.user.id, await this.hasher.hash(next));
    this.sessions.deleteAllForUser(session.user.id, session.tokenHash);
  }

  // --- Sessão ------------------------------------------------------------------

  /** Conta dona do token, se a sessão existe e não venceu (absoluta e por inatividade). */
  resolve(token: string | undefined): AuthSession | null {
    if (!token || token.length > 100) return null;
    const tokenHash = this.tokens.hash(token, 'session');
    const session = this.sessions.find(tokenHash);
    if (!session) return null;
    const now = this.now();
    if (session.expiresAt <= now || session.lastSeenAt + this.idleMs <= now) {
      this.sessions.delete(tokenHash);
      return null;
    }
    const user = this.users.findById(session.userId);
    if (!user) return null;
    if (now - session.lastSeenAt > TOUCH_EVERY_MS) this.sessions.touch(tokenHash, now);
    return { user, tokenHash };
  }

  /** A sessão (pelo hash) ainda vale? Conferido periodicamente nas conexões WebSocket. */
  stillValid(tokenHash: string): boolean {
    const session = this.sessions.find(tokenHash);
    const now = this.now();
    return !!session && session.expiresAt > now && session.lastSeenAt + this.idleMs > now;
  }

  /** Duração máxima do cookie, em segundos. */
  get sessionMaxAgeSeconds(): number {
    return this.config.SESSION_TTL_HOURS * 3600;
  }

  /** Apaga sessões vencidas (rodado periodicamente pelo servidor). */
  sweep(): number {
    return this.sessions.deleteExpired(this.now(), this.idleMs);
  }

  private get idleMs(): number {
    return this.config.SESSION_IDLE_HOURS * 3_600_000;
  }

  private openSession(userId: string): string {
    const token = this.tokens.generate();
    const now = this.now();
    this.sessions.create(this.tokens.hash(token, 'session'), userId, now, now + this.config.SESSION_TTL_HOURS * 3_600_000);
    return token;
  }
}
