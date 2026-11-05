// Imita o programa `tailscale` nos testes de ponta a ponta (`npm run e2e`), sem instalar nada e sem
// abrir nada para a internet. Responde como a versão real: status e o túnel em primeiro plano.
const args = process.argv.slice(2);
const [command] = args;

if (command === 'status') {
  console.log(JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'mesa-de-teste.tail0000.ts.net.' } }));
} else if (command === 'funnel' && args.includes('off')) {
  process.exit(0);
} else if (command === 'funnel') {
  console.log('Available on the internet:\n\nhttps://mesa-de-teste.tail0000.ts.net/\n|-- proxy http://127.0.0.1\n\nPress Ctrl+C to exit.');
  // Em primeiro plano: fica rodando até ser encerrado, como o real
  setInterval(() => undefined, 60_000);
} else {
  process.exit(1);
}
