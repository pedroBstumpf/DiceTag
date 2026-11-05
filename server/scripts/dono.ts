import { loadConfig } from '../src/config/env';
import { createContext } from '../src/context';
import { openDatabase } from '../src/db/database';
import { email as emailSchema, newPassword, text } from '../src/lib/schemas';
import { appEnv, home } from './lib/app-env';
import { ask, askHidden } from './lib/terminal';

/**
 * Cria a conta do dono do app ou troca os dados dela (nome, e-mail de entrada e senha), na pasta do
 * app (a mesma de `npm run mesa`).
 *
 *   npm run dono
 *
 * É o único jeito de criar ou alterar essa conta: exige acesso ao terminal desta máquina, então
 * ninguém consegue fazer isso pela internet, mesmo com a mesa aberta. Trocar a senha encerra as
 * sessões do dono. Também serve quando a senha foi esquecida.
 *
 * Para automação (testes), os dados podem vir de DONO_NOME, DONO_EMAIL e DONO_SENHA.
 */
const config = loadConfig(appEnv());
const db = openDatabase(config.DATABASE_PATH);
const ctx = createContext(config, db);
const current = ctx.users.owner();

console.log(`\nPasta do app: ${home}`);
console.log(current ? `Alterando o dono do app (hoje: ${current.name}).\n` : 'Criando o dono do app: a sua conta, a única que entra com senha.\n');
const name = text(1, 60).parse(process.env['DONO_NOME'] ?? (await ask(`Seu nome${current ? ` [${current.name}]` : ''}: `, current?.name)));
const email = emailSchema.parse(process.env['DONO_EMAIL'] ?? (await ask(`E-mail para entrar${current ? ` [${current.email}]` : ''}: `, current?.email)));
const password = newPassword.parse(process.env['DONO_SENHA'] ?? (await askHidden('Senha (de 8 a 128 caracteres): ')));
if (!process.env['DONO_SENHA'] && (await askHidden('Repita a senha: ')) !== password) {
  console.error('As senhas não conferem. Nada foi alterado.');
  process.exit(1);
}

const owner = await ctx.auth.setOwner({ name, email, password });
db.close();
console.log(`\nPronto: ${owner.name} é o dono do app.`);
