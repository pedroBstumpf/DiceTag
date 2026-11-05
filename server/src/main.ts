import { existsSync } from 'node:fs';
import { buildApp } from './app';
import { loadConfig } from './config/env';
import { createContext } from './context';
import { openDatabase } from './db/database';

/**
 * Ponto de entrada: lê o `.env`, abre o banco, sobe HTTP + WebSocket e desliga com cuidado
 * (grava as mesas abertas e fecha o banco) ao receber Ctrl+C ou SIGTERM.
 */
async function main(): Promise<void> {
  // `.env` com os segredos (nativo do Node, sem pacote dotenv). Variáveis já definidas têm prioridade.
  if (existsSync('.env')) process.loadEnvFile('.env');
  const config = loadConfig();
  const db = openDatabase(config.DATABASE_PATH);
  const ctx = createContext(config, db);
  const { http } = await buildApp(ctx);

  // Limpeza periódica de sessões vencidas
  const sweeper = setInterval(() => ctx.auth.sweep(), 60 * 60_000);
  sweeper.unref();

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    http.log.info({ signal }, 'desligando');
    clearInterval(sweeper);
    await http.close();
    db.close();
    process.exit(0);
  };
  // Iniciado por `npm run mesa`: se aquele processo morrer, este não fica aberto sozinho
  if (process.send && process.env['ZEHENIA_MESA']) process.on('disconnect', () => void shutdown('disconnect'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await http.listen({ host: config.HOST, port: config.PORT });
  if (config.DEV_TOOLS) http.log.info(`página de testes: http://localhost:${config.PORT}/dev/`);
}

main().catch((err: unknown) => {
  // Configuração inválida e falhas na subida: mensagem clara, sem stack de segredos
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
