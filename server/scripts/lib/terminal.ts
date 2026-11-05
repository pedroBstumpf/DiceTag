import { createInterface } from 'node:readline/promises';

/** Pergunta no terminal. `fallback`: valor usado se a pessoa só apertar Enter. */
export async function ask(question: string, fallback = ''): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim() || fallback;
  } finally {
    rl.close();
  }
}

/** Pergunta sem mostrar o que é digitado (senhas). */
export function askHidden(question: string): Promise<string> {
  process.stdout.write(question);
  const { stdin } = process;
  // Fora de um terminal (entrada redirecionada), lê a linha normalmente
  if (!stdin.isTTY) return ask('');
  return new Promise((resolve) => {
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        // Ctrl+C
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          process.stdout.write('\n');
          process.exit(130);
        }
        if (ch === '\u0008' || ch === '\u007f') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}
