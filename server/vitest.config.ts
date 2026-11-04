import { defineConfig } from 'vitest/config';

/** Testes do servidor: unidade (funções puras) e integração (HTTP + WebSocket reais, banco em memória). */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Cada arquivo sobe o próprio servidor em memória; em sequência evita disputa de portas e CPU do scrypt
    fileParallelism: false,
    testTimeout: 20_000,
    // node:sqlite ainda é experimental no Node: o aviso só polui a saída
    execArgv: ['--disable-warning=ExperimentalWarning'],
  },
});
