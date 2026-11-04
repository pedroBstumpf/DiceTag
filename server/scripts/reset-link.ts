import { existsSync } from 'node:fs';
import { loadConfig } from '../src/config/env';
import { createContext } from '../src/context';
import { openDatabase } from '../src/db/database';
import { email as emailSchema } from '../src/lib/schemas';

/**
 * Gera um link de recuperação de senha para uma conta, para quem administra o servidor enviar à
 * pessoa quando não há serviço de e-mail configurado (ex.: um teste fechado entre amigos).
 *
 *   npm run reset-link -- pessoa@exemplo.com
 *
 * O link dá acesso à conta: envie só à própria pessoa, por um canal de confiança. Vale pelo mesmo
 * prazo do link por e-mail, uma vez só, e encerra todas as sessões da conta ao ser usado.
 */
if (existsSync('.env')) process.loadEnvFile('.env');

const parsed = emailSchema.safeParse(process.argv[2] ?? '');
if (!parsed.success) {
  console.error('Uso: npm run reset-link -- pessoa@exemplo.com');
  process.exit(1);
}

const config = loadConfig();
const db = openDatabase(config.DATABASE_PATH);
const ctx = createContext(config, db);
const request = ctx.auth.createPasswordReset(parsed.data, { ignoreCooldown: true });
db.close();

if (!request) {
  console.error('Não há conta com esse e-mail.');
  process.exit(1);
}
console.log(`\nLink de recuperação de ${request.user.name} (envie só a essa pessoa):\n\n${request.link}\n`);
