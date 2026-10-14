import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * Cria o `.env` a partir do `.env.example`, com segredos aleatórios novos (48 bytes cada).
 * Não sobrescreve um `.env` existente (use `--force` para recriar — isso invalida senhas e sessões).
 */
const force = process.argv.includes('--force');
if (existsSync('.env') && !force) {
  console.log('O arquivo .env já existe; nada foi alterado. (Use `npm run setup -- --force` para recriar.)');
  process.exit(0);
}

const secret = () => randomBytes(48).toString('base64url');
const values: Record<string, string> = {
  TOKEN_SECRET: secret(),
  PASSWORD_PEPPER: secret(),
  SEED_PASSWORD: randomBytes(12).toString('base64url'),
};

const env = readFileSync('.env.example', 'utf8').replace(/^(TOKEN_SECRET|PASSWORD_PEPPER|SEED_PASSWORD)=.*$/gm, (_line, key: string) => `${key}=${values[key]}`);
// 0o600: só o seu usuário lê o arquivo (no Windows, vale a permissão da pasta do usuário)
writeFileSync('.env', env, { mode: 0o600 });
console.log('Arquivo .env criado com segredos novos. Próximos passos: `npm run seed` e `npm run dev`.');
