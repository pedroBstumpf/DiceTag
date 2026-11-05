import { spawnSync } from 'node:child_process';
import { sandboxArgs } from './app-env';

/**
 * Usado por `npm run e2e`: roda um script com exatamente as permissões do servidor exposto (as mesmas
 * de `sandboxArgs`) e repassa o resultado, para provar o que o processo consegue ou não fazer.
 */
const [script, ...rest] = process.argv.slice(2);
const result = spawnSync(process.execPath, [...sandboxArgs(), script, ...rest], { encoding: 'utf8' });
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
