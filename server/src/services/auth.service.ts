import type { Config } from '../config/env';
import { transaction, type Db } from '../db/database';
import { HttpError, badRequest, conflict } from '../lib/errors';
import { newId } from '../lib/ids';
import { loginNameOf, validGuestName } from '../lib/login-name';
import { email as emailSchema } from '../lib/schemas';
import type { PasswordResetsRepository } from '../repositories/password-resets';
import type { SessionsRepository } from '../repositories/sessions';
import { NAME_TAKEN, isUniqueViolation, type GuestCredentials, type PublicUser, type UserKind, type UsersRepository } from '../repositories/users';
import type { WorldsRepository } from '../repositories/worlds';
import { LoginThrottle } from '../security/login-throttle';
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
/** Validade do link de recuperação de senha (BACKEND_SECURITY.md §1: de 30 a 60 minutos). */
export const PASSWORD_RESET_MINUTES = 30;
/** Resposta única do login (não entrega se o nome ou o e-mail têm conta). */
export const LOGIN_FAILED = 'Nome, e-mail ou senha inválidos.';
/** Tempo mínimo entre dois e-mails de recuperação para a mesma conta (ninguém enche a caixa de outra pessoa). */
const RESET_COOLDOWN_MS = 2 * 60_000;
const RESET_INVALID = 'Este link é inválido ou já venceu. Peça outro em "Esqueci minha senha".';

/**
 * Contas e sessões. **Não há cadastro público:** o dono do app é criado pelo terminal
 * (`npm run dono`), e todos os demais entram por um convite (`createGuest`), com o nome da mesa
 * e uma senha; depois, entram por esse nome (único, `lib/login-name.ts`) e a senha.
 *
 * - Login com mensagem única para conta inexistente e senha errada, e o mesmo tempo de
 *   resposta nos dois casos (`dummyVerify`): não dá para descobrir quais nomes ou e-mails têm conta.
 * - Falhas de login: atraso crescente por login + IP e, com mais folga, por login
 *   (`LoginThrottle`), em vez de bloquear a conta por um tempo fixo.
 * - Sessão nova a cada login (o token antigo não é reaproveitado: sem fixação de sessão).
 * - Trocar a senha encerra TODAS as sessões da conta e abre uma nova (id novo a cada mudança
 *   de credencial); "sair de todos os dispositivos" encerra todas.
 * - Recuperação de senha: token de uso único e prazo curto, com só o HMAC no banco; quem pede não
 *   descobre se o e-mail tem conta; redefinir encerra TODAS as sessões e não abre uma nova.
 * - Quem chama avisa o hub para derrubar na hora os WebSockets das sessões encerradas.
 */
export class AuthService {
  private readonly throttle: LoginThrottle;

  constructor(
    private readonly db: Db,
    private readonly users: UsersRepository,
    private readonly sessions: SessionsRepository,
    private readonly worlds: WorldsRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
    private readonly config: Config,
    private readonly resets: PasswordResetsRepository,
    private readonly now: () => number = Date.now,
  ) {
    this.throttle = new LoginThrottle(now);
  }

  // --- Cadastro e login --------------------------------------------------------

  /**
   * Cria o dono do app ou, se ele já existe, troca o nome, o e-mail e a senha dele. Só é chamado
   * pelo terminal de quem tem acesso à máquina (`npm run dono`); nenhuma rota chega aqui.
   */
  async setOwner(input: { name: string; email: string; password: string }): Promise<PublicUser> {
    const owner = this.users.owner();
    if (!owner) return (await this.createAccount(input, 'owner')).user;
    const problem = passwordProblem(input.password, input.email);
    if (problem) throw badRequest(problem);
    const hash = await this.hasher.hash(input.password);
    transaction(this.db, () => {
      if (input.email !== owner.email && this.users.emailTaken(input.email)) throw conflict('Esse e-mail já está em uso.');
      this.users.updateOwner(owner.id, input.name, input.email);
      this.users.setPasswordHash(owner.id, hash);
      this.sessions.deleteAllForUser(owner.id);
    });
    return { ...owner, name: input.name, email: input.email };
  }

  /** Conta com e-mail e senha. Só para uso interno: dono, dados de exemplo e testes. */
  async createAccount(input: { name: string; email: string; password: string }, kind: UserKind): Promise<{ user: PublicUser; token: string }> {
    const problem = passwordProblem(input.password, input.email);
    if (problem) throw badRequest(problem);
    // Hash antes da transação (é lento e não precisa segurar o banco)
    const passwordHash = await this.hasher.hash(input.password);
    const now = this.now();
    const user: PublicUser = { id: newId(), name: input.name, email: input.email, kind, createdAt: now, hasPassword: true };
    transaction(this.db, () => {
      if (this.users.emailTaken(input.email)) throw conflict('Não foi possível criar a conta com esse e-mail.');
      this.users.create({ ...user, passwordHash });
      if (kind === 'owner') this.worlds.create({ id: newId(), ownerId: user.id, name: FIRST_WORLD_NAME, createdAt: now });
    });
    return { user, token: this.openSession(user) };
  }

  /**
   * Confere o nome e a senha de um convidado e calcula o hash (lento: fora de qualquer transação).
   * Não grava nada: o resultado vai para `createGuest` ou `setGuestPassword`.
   */
  async guestCredentials(name: string, password: string): Promise<GuestCredentials> {
    if (!validGuestName(name)) throw badRequest('Escolha um nome sem @.');
    const problem = passwordProblem(password, name);
    if (problem) throw badRequest(problem);
    return { loginName: loginNameOf(name), passwordHash: await this.hasher.hash(password) };
  }

  /**
   * Conta de convidado com nome e senha (quem chama já conferiu o convite, na mesma transação).
   * Nome de entrada repetido → 409 (o índice único segura dois pedidos ao mesmo tempo).
   */
  createGuest(name: string, credentials: GuestCredentials): PublicUser {
    if (this.users.loginTaken(credentials.loginName)) throw conflict(NAME_TAKEN);
    try {
      return this.users.createGuest(newId(), name, this.now(), credentials);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict(NAME_TAKEN);
      throw err;
    }
  }

  /** Abre uma sessão para quem apresentou um convite válido. */
  sessionFor(user: PublicUser): string {
    return this.openSession(user);
  }

  /**
   * Login pelo e-mail (dono: tem `@`) ou pelo nome da mesa (convidado com senha). `ip`: de onde veio a
   * tentativa (o atraso crescente conta login + IP e só o login, já normalizado).
   */
  async login(login: string, password: string, ip: string): Promise<{ user: PublicUser; token: string }> {
    const byEmail = login.includes('@');
    const parsedEmail = byEmail ? emailSchema.safeParse(login) : null;
    const key = parsedEmail?.success ? parsedEmail.data : byEmail ? login.trim().toLowerCase() : loginNameOf(login);
    const wait = this.throttle.waitMs(key, ip);
    if (wait > 0) {
      throw new HttpError(429, `Muitas tentativas para esta conta. Tente novamente em ${Math.ceil(wait / 1000)} s.`);
    }
    const found = byEmail ? (parsedEmail?.success ? this.users.credentialsByEmail(key) : null) : this.users.credentialsByLogin(key);
    const ok = found ? await this.hasher.verify(password, found.passwordHash) : (await this.hasher.dummyVerify(password), false);
    if (!found || !ok) {
      this.throttle.fail(key, ip);
      throw new HttpError(401, LOGIN_FAILED);
    }
    this.throttle.succeed(key, ip);
    // Custo do hash mudou desde o cadastro: refaz agora que temos a senha
    if (this.hasher.needsRehash(found.passwordHash)) this.users.setPasswordHash(found.user.id, await this.hasher.hash(password));
    return { user: found.user, token: this.openSession(found.user) };
  }

  logout(token: string): void {
    this.sessions.delete(this.tokens.hash(token, 'session'));
  }

  /** Confirma a senha da conta (ex.: antes de excluí-la). */
  async verifyPassword(userId: string, password: string): Promise<boolean> {
    const stored = this.users.passwordHashOf(userId);
    return !!stored && (await this.hasher.verify(password, stored));
  }

  /** Sair de todos os dispositivos: encerra todas as sessões da conta. */
  logoutAll(userId: string): void {
    this.sessions.deleteAllForUser(userId);
  }

  /** Troca a senha, encerra todas as sessões e devolve o token da sessão nova (só para quem trocou). */
  async changePassword(session: AuthSession, current: string, next: string): Promise<string> {
    const stored = this.users.passwordHashOf(session.user.id);
    if (!stored || !(await this.hasher.verify(current, stored))) throw new HttpError(401, 'Senha atual incorreta.');
    const problem = passwordProblem(next, session.user.email);
    if (problem) throw badRequest(problem);
    const hash = await this.hasher.hash(next);
    return transaction(this.db, () => {
      this.users.setPasswordHash(session.user.id, hash);
      this.sessions.deleteAllForUser(session.user.id);
      return this.openSession(session.user);
    });
  }

  // --- Recuperação de senha ------------------------------------------------------

  /**
   * Cria o pedido e devolve o link (só para o e-mail da própria pessoa). null = não há o que enviar:
   * e-mail sem conta, ou um pedido recente da mesma conta (quem pediu vê a mesma resposta nos dois casos).
   * `ignoreCooldown`: quem administra o servidor gerando o link à mão.
   */
  createPasswordReset(email: string, options: { ignoreCooldown?: boolean } = {}): { user: PublicUser; link: string } | null {
    const user = this.users.credentialsByEmail(email)?.user;
    if (!user) return null;
    const now = this.now();
    const last = this.resets.lastRequestAt(user.id);
    if (!options.ignoreCooldown && last !== null && now - last < RESET_COOLDOWN_MS) return null;
    const token = this.tokens.generate();
    this.resets.replace(this.tokens.hash(token, 'reset'), user.id, now, now + PASSWORD_RESET_MINUTES * 60_000);
    // Fragmento (#): não vai ao servidor, a logs de proxy nem a outros sites pelo Referer
    return { user, link: `${this.config.publicUrl}/redefinir-senha#token=${token}` };
  }

  /**
   * Troca a senha com um link válido, gasta o link e encerra todas as sessões da conta. Devolve a
   * conta (quem chama derruba os WebSockets dela). Quem redefine entra de novo com a senha nova.
   */
  async resetPassword(token: string, next: string, ip: string): Promise<string> {
    const tokenHash = this.tokens.hash(token, 'reset');
    const request = this.resets.find(tokenHash);
    const user = request && request.expiresAt > this.now() ? this.users.findById(request.userId) : null;
    if (!request || !user) throw badRequest(RESET_INVALID);
    const problem = passwordProblem(next, user.email);
    if (problem) throw badRequest(problem);
    const hash = await this.hasher.hash(next);
    transaction(this.db, () => {
      // Conferido de novo aqui: o hash leva tempo, e o mesmo link pode ter sido usado nesse meio-tempo
      if (!this.resets.consume(tokenHash, this.now())) throw badRequest(RESET_INVALID);
      this.users.setPasswordHash(user.id, hash);
      this.sessions.deleteAllForUser(user.id);
      this.resets.deleteForUser(user.id);
    });
    // Quem provou ser dono do e-mail não fica preso ao atraso das tentativas de login anteriores
    this.throttle.succeed(user.email, ip);
    return user.id;
  }

  // --- Sessão ------------------------------------------------------------------

  /** Conta dona do token, se a sessão existe e não venceu (absoluta e por inatividade). */
  resolve(token: string | undefined): AuthSession | null {
    if (!token || token.length > 100) return null;
    const tokenHash = this.tokens.hash(token, 'session');
    const session = this.sessions.find(tokenHash);
    if (!session) return null;
    const now = this.now();
    const user = this.users.findById(session.userId);
    if (!user || !this.isAlive(session, user, now)) {
      this.sessions.delete(tokenHash);
      return null;
    }
    if (now - session.lastSeenAt > TOUCH_EVERY_MS) this.sessions.touch(tokenHash, now);
    return { user, tokenHash };
  }

  /** A sessão (pelo hash) ainda vale? Conferido periodicamente nas conexões WebSocket. */
  stillValid(tokenHash: string): boolean {
    const session = this.sessions.find(tokenHash);
    const user = session && this.users.findById(session.userId);
    return !!session && !!user && this.isAlive(session, user, this.now());
  }

  /** Dentro do prazo total e, para quem tem senha, do prazo de inatividade. */
  private isAlive(session: { expiresAt: number; lastSeenAt: number }, user: PublicUser, now: number): boolean {
    return session.expiresAt > now && (user.kind === 'guest' || session.lastSeenAt + this.idleMs > now);
  }

  /** Duração máxima do cookie da conta, em segundos. */
  sessionMaxAgeSeconds(user: PublicUser): number {
    return this.sessionTtlMs(user) / 1000;
  }

  private sessionTtlMs(user: PublicUser): number {
    return user.kind === 'guest' ? this.config.GUEST_SESSION_DAYS * 86_400_000 : this.config.SESSION_TTL_HOURS * 3_600_000;
  }

  /** Apaga sessões e pedidos de recuperação vencidos (rodado periodicamente pelo servidor). */
  sweep(): number {
    this.resets.deleteExpired(this.now());
    return this.sessions.deleteExpired(this.now(), this.idleMs);
  }

  private get idleMs(): number {
    return this.config.SESSION_IDLE_HOURS * 3_600_000;
  }

  private openSession(user: PublicUser): string {
    const token = this.tokens.generate();
    const now = this.now();
    this.sessions.create(this.tokens.hash(token, 'session'), user.id, now, now + this.sessionTtlMs(user));
    return token;
  }
}
