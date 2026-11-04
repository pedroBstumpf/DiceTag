import { BlockList, isIP } from 'node:net';

/**
 * IP real de quem fez a requisição atrás de proxies reversos — a mesma regra do
 * `trustProxy: [IPs/CIDRs]` do Fastify (pacote proxy-addr), para o HTTP e o WebSocket contarem o
 * mesmo IP nos limites de taxa.
 *
 * Cada proxy acrescenta ao FIM do `X-Forwarded-For` o endereço que viu. Partindo da conexão,
 * só se "pula" um endereço se ele for um proxy da lista; o primeiro que não for é o cliente.
 * Assim, quem fala direto com o servidor (sem passar pelo proxy) não consegue fingir outro IP:
 * o endereço da conexão dele não está na lista. Por isso não há confiança por número de saltos
 * (o Fastify 5 também a desativou).
 */
export class TrustedProxies {
  private readonly list = new BlockList();
  readonly entries: readonly string[];

  /** `entries`: IPs ou faixas CIDR (ex.: `127.0.0.1`, `10.0.0.0/8`, `::1`). Lança se algum for inválido. */
  constructor(entries: readonly string[]) {
    this.entries = entries;
    for (const entry of entries) {
      const [address, prefix] = entry.split('/');
      const family = isIP(address);
      if (!family) throw new Error(`endereço inválido: "${entry}"`);
      const type = family === 4 ? 'ipv4' : 'ipv6';
      if (prefix === undefined) {
        this.list.addAddress(address, type);
        continue;
      }
      const bits = Number(prefix);
      if (!/^\d+$/.test(prefix) || bits > (family === 4 ? 32 : 128)) throw new Error(`faixa inválida: "${entry}"`);
      this.list.addSubnet(address, bits, type);
    }
  }

  /** O endereço é de um proxy confiável? (IPv4 escrito como IPv6, `::ffff:1.2.3.4`, também vale) */
  has(address: string): boolean {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
    const ip = mapped ?? address;
    const family = isIP(ip);
    return !!family && this.list.check(ip, family === 4 ? 'ipv4' : 'ipv6');
  }
}

/** IP do cliente: anda da conexão para trás no `X-Forwarded-For` enquanto o endereço for um proxy confiável. */
export function clientIp(remote: string | undefined, forwarded: string | string[] | undefined, trusted: TrustedProxies): string {
  const socket = remote ?? 'desconhecido';
  if (!trusted.entries.length) return socket;
  const listed = (Array.isArray(forwarded) ? forwarded.join(',') : (forwarded ?? ''))
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean);
  const chain = [socket, ...listed.reverse()];
  let i = 0;
  while (i < chain.length - 1 && trusted.has(chain[i])) i++;
  return chain[i];
}
