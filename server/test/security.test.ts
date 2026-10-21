import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loadConfig } from '../src/config/env';
import { TrustedProxies, clientIp } from '../src/lib/client-ip';
import { isSafeId } from '../src/lib/ids';
import { Semaphore, TokenBucket, WindowLimiter } from '../src/lib/limiter';
import { parseJsonSafely, unsafeJsonReason } from '../src/lib/safe-json';
import { newPassword, withPasswordPolicy } from '../src/lib/schemas';
import { declaredTypeMatches, detectFileType } from '../src/security/file-type';
import { isAllowedOrigin } from '../src/security/origin';
import { LoginThrottle } from '../src/security/login-throttle';
import { PasswordHasher, passwordProblem } from '../src/security/password';
import { TokenService } from '../src/security/tokens';
import { PNG_1X1 } from './helpers';

const secret = () => randomBytes(32).toString('hex');

describe('senhas (scrypt + pimenta)', () => {
  const peppers = (version = 1, current = secret(), previous?: Map<number, string>) => ({ version, current, previous });
  const v1 = peppers();
  const hasher = new PasswordHasher(v1, 14);
  const password = randomBytes(12).toString('base64url');

  it('formato autodescritivo: versão da pimenta e parâmetros no hash', async () => {
    const hash = await hasher.hash(password);
    expect(hash).toMatch(/^scrypt\$1\$N=16384,r=8,p=1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(await hasher.verify(password, hash)).toBe(true);
    expect(await hasher.verify(`${password}x`, hash)).toBe(false);
  });

  it('o mesmo texto gera hashes diferentes (sal aleatório)', async () => {
    expect(await hasher.hash(password)).not.toBe(await hasher.hash(password));
  });

  it('sem a pimenta certa, o hash não confere (vazar só o banco não basta)', async () => {
    const hash = await hasher.hash(password);
    expect(await new PasswordHasher(peppers(), 14).verify(password, hash)).toBe(false);
  });

  it('pimenta trocada: hashes da versão anterior continuam valendo e pedem novo hash', async () => {
    const old = await hasher.hash(password);
    const rotated = new PasswordHasher(peppers(2, secret(), new Map([[1, v1.current]])), 14);
    expect(await rotated.verify(password, old)).toBe(true);
    expect(rotated.needsRehash(old)).toBe(true);
    const fresh = await rotated.hash(password);
    expect(fresh.startsWith('scrypt$2$')).toBe(true);
    expect(rotated.needsRehash(fresh)).toBe(false);
    // Versão sem pimenta configurada: não confere
    expect(await new PasswordHasher(peppers(3), 14).verify(password, old)).toBe(false);
  });

  it('formato anterior (sem versão) vale como pimenta 1 e pede novo hash', async () => {
    const [, , , salt, key] = (await hasher.hash(password)).split('$');
    const legacy = ['scrypt', 14, 8, 1, salt, key].join('$');
    expect(await hasher.verify(password, legacy)).toBe(true);
    expect(hasher.needsRehash(legacy)).toBe(true);
  });

  it('hash malformado não lança, só recusa', async () => {
    for (const bad of ['', 'scrypt$', 'bcrypt$1$2$3$4$5', 'scrypt$99$8$1$AA$AA', 'scrypt$1$N=99,r=8,p=1$AA$AA', 'scrypt$x$N=16384,r=8,p=1$AA$AA']) {
      expect(await hasher.verify(password, bad)).toBe(false);
    }
  });

  it('pede novo hash quando o custo muda', async () => {
    const hash = await hasher.hash(password);
    expect(hasher.needsRehash(hash)).toBe(false);
    expect(new PasswordHasher(v1, 15).needsRehash(hash)).toBe(true);
  });

  it('política no zod: senha nova validada no esquema, inclusive contra o e-mail', () => {
    expect(newPassword.safeParse('12345678').success).toBe(false);
    expect(newPassword.safeParse('uma frase bem longa').success).toBe(true);
    const body = withPasswordPolicy(z.strictObject({ email: z.string(), password: z.string() }));
    expect(body.safeParse({ email: 'fulano.silva@b.co', password: 'fulano.silva' }).success).toBe(false);
  });

  it('política: tamanho, senhas comuns, repetição e e-mail', () => {
    expect(passwordProblem('curta', 'a@b.co')).toMatch(/pelo menos 8/);
    expect(passwordProblem('x'.repeat(129), 'a@b.co')).toMatch(/no máximo/);
    expect(passwordProblem('12345678', 'a@b.co')).toMatch(/comum/);
    expect(passwordProblem('aaaaaaaaaa', 'a@b.co')).toMatch(/repetido/);
    expect(passwordProblem('fulano.silva', 'fulano.silva@b.co')).toMatch(/e-mail/);
    expect(passwordProblem('uma frase bem longa', 'a@b.co')).toBeNull();
  });
});

describe('tokens', () => {
  it('são aleatórios e o hash depende do segredo e do propósito', () => {
    const tokens = new TokenService(secret());
    const a = tokens.generate();
    expect(a).not.toBe(tokens.generate());
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(tokens.hash(a, 'session')).not.toBe(tokens.hash(a, 'invite'));
    expect(tokens.hash(a, 'session')).not.toBe(new TokenService(secret()).hash(a, 'session'));
  });
});

describe('ids', () => {
  it('aceita UUID e ids do front-end; recusa caminhos, HTML e chaves de protótipo', () => {
    expect(isSafeId('9b2f6c1e-1d2a-4c2b-9a51-0f0e4a3b2c1d')).toBe(true);
    expect(isSafeId('status-body')).toBe(true);
    for (const bad of ['', '../etc/passwd', 'a/b', '<script>', '__proto__', 'constructor', 'prototype', 'x'.repeat(65), 'a b']) {
      expect(isSafeId(bad)).toBe(false);
    }
  });
});

describe('JSON seguro', () => {
  it('recusa chaves de protótipo no parse', () => {
    expect(() => parseJsonSafely('{"__proto__":{"admin":true}}')).toThrow();
    expect(() => parseJsonSafely('{"a":{"constructor":{"prototype":{}}}}')).toThrow();
    expect(parseJsonSafely('{"a":[1,2,{"b":null}]}')).toEqual({ a: [1, 2, { b: null }] });
  });

  it('recusa estruturas profundas, grandes ou com tipos que não são JSON', () => {
    let deep: unknown = 1;
    for (let i = 0; i < 40; i++) deep = [deep];
    expect(unsafeJsonReason(deep)).toMatch(/profunda/);
    expect(unsafeJsonReason({ a: 'x'.repeat(11) }, { maxDepth: 5, maxNodes: 10, maxStringLength: 10 })).toMatch(/texto/);
    expect(unsafeJsonReason(Array.from({ length: 20 }, () => 1), { maxDepth: 5, maxNodes: 10, maxStringLength: 10 })).toMatch(/grandes/);
    expect(unsafeJsonReason({ n: Number.POSITIVE_INFINITY })).toMatch(/número/);
    expect(unsafeJsonReason({ d: new Date() })).toMatch(/objeto/);
    expect(unsafeJsonReason(JSON.parse('{"__proto__":1}'))).toMatch(/chave/);
    expect(unsafeJsonReason({ ok: [1, 'a', true, null, { b: 2 }] })).toBeNull();
  });
});

describe('tipo real do arquivo', () => {
  it('reconhece imagens e áudios pelos bytes', () => {
    expect(detectFileType(PNG_1X1)).toBe('image/png');
    expect(detectFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectFileType(Buffer.from('GIF89a....'))).toBe('image/gif');
    expect(detectFileType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(detectFileType(Buffer.from('ID3\x04\0\0'))).toBe('audio/mpeg');
    expect(detectFileType(Buffer.from('OggS\0\x02'))).toBe('audio/ogg');
    expect(detectFileType(Buffer.from('RIFF\0\0\0\0WAVEfmt '))).toBe('audio/wav');
  });

  it('recusa SVG, HTML, PDF e executáveis, mesmo com nome de imagem', () => {
    expect(detectFileType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(detectFileType(Buffer.from('<!doctype html><script>alert(1)</script>'))).toBeNull();
    expect(detectFileType(Buffer.from('%PDF-1.7'))).toBeNull();
    expect(detectFileType(Buffer.from('MZ\x90\0'))).toBeNull();
    expect(detectFileType(Buffer.alloc(0))).toBeNull();
  });
});

describe('nome e tipo declarado do arquivo', () => {
  it('a extensão tem de ser a do tipo detectado; o tipo declarado, da mesma família ou genérico', () => {
    expect(declaredTypeMatches('mapa.png', 'image/png', 'image/png')).toBe(true);
    expect(declaredTypeMatches('mapa.png', '', 'image/png')).toBe(true);
    expect(declaredTypeMatches('mapa.jpg', 'image/png', 'image/png')).toBe(false);
    expect(declaredTypeMatches('mapa.png', 'image/svg+xml', 'image/png')).toBe(false);
    expect(declaredTypeMatches('tema.webm', 'video/webm', 'audio/webm')).toBe(true);
    expect(declaredTypeMatches('tema.ogg', 'application/ogg', 'audio/ogg')).toBe(true);
    expect(declaredTypeMatches('tema.m4a', 'audio/x-m4a', 'audio/mp4')).toBe(true);
    // MP4 com marca genérica e extensão de vídeo: não passa como áudio
    expect(declaredTypeMatches('filme.mp4', 'video/mp4', 'audio/mp4')).toBe(false);
    expect(declaredTypeMatches('tema.mp3', 'text/html', 'audio/mpeg')).toBe(false);
  });
});

describe('origem (CSRF/CSWSH)', () => {
  const allowed = new Set(['http://localhost:4200']);
  it('aceita só origens da lista; sem Origin, só same-origin do navegador', () => {
    expect(isAllowedOrigin({ origin: 'http://localhost:4200' }, allowed)).toBe(true);
    expect(isAllowedOrigin({ origin: 'http://localhost:4200.evil.com' }, allowed)).toBe(false);
    expect(isAllowedOrigin({ origin: 'null' }, allowed)).toBe(false);
    expect(isAllowedOrigin({ 'sec-fetch-site': 'same-origin' }, allowed)).toBe(true);
    expect(isAllowedOrigin({ 'sec-fetch-site': 'cross-site' }, allowed)).toBe(false);
    expect(isAllowedOrigin({}, allowed)).toBe(false);
  });
});

describe('atraso crescente no login', () => {
  it('5 falhas livres por e-mail + IP; depois a espera dobra a cada falha, até 15 min', () => {
    let now = 0;
    const throttle = new LoginThrottle(() => now);
    for (let i = 0; i < 5; i++) {
      expect(throttle.waitMs('a@b.co', 'ip1')).toBe(0);
      throttle.fail('a@b.co', 'ip1');
    }
    expect(throttle.waitMs('a@b.co', 'ip1')).toBe(30_000);
    now += 30_000;
    throttle.fail('a@b.co', 'ip1');
    expect(throttle.waitMs('a@b.co', 'ip1')).toBe(60_000);
    for (let i = 0; i < 10; i++) throttle.fail('a@b.co', 'ip1');
    expect(throttle.waitMs('a@b.co', 'ip1')).toBe(15 * 60_000);
    // Outro IP não espera por causa deste
    expect(throttle.waitMs('a@b.co', 'ip2')).toBe(0);
  });

  it('ataque distribuído: a conta inteira espera depois de 20 falhas de vários IPs', () => {
    const throttle = new LoginThrottle(() => 0);
    for (let i = 0; i < 20; i++) throttle.fail('a@b.co', `ip${i}`);
    expect(throttle.waitMs('a@b.co', 'ip-novo')).toBe(30_000);
  });

  it('acerto zera o par; falhas são esquecidas uma hora depois da última', () => {
    let now = 0;
    const throttle = new LoginThrottle(() => now);
    for (let i = 0; i < 5; i++) throttle.fail('a@b.co', 'ip1');
    throttle.succeed('a@b.co', 'ip1');
    expect(throttle.waitMs('a@b.co', 'ip1')).toBe(0);
    for (let i = 0; i < 5; i++) throttle.fail('c@d.co', 'ip1');
    now += 60 * 60_000 + 1;
    expect(throttle.waitMs('c@d.co', 'ip1')).toBe(0);
  });
});

describe('limitadores', () => {
  it('janela: bloqueia acima do máximo e libera quando a janela vira', () => {
    let now = 0;
    const limiter = new WindowLimiter(2, 1000, () => now);
    expect(limiter.hit('a')).toBe(true);
    expect(limiter.hit('a')).toBe(true);
    expect(limiter.hit('a')).toBe(false);
    expect(limiter.blocked('a')).toBe(true);
    expect(limiter.hit('b')).toBe(true);
    now = 1000;
    expect(limiter.hit('a')).toBe(true);
  });

  it('balde de fichas: permite rajada e recarrega com o tempo', () => {
    let now = 0;
    const bucket = new TokenBucket(2, 3, () => now);
    expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual([true, true, true, false]);
    now = 500;
    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);
  });

  it('semáforo: nunca passa do limite e recusa quando a fila enche', async () => {
    const semaphore = new Semaphore(2, 3);
    let active = 0;
    let peak = 0;
    const task = () =>
      semaphore.run(async () => {
        peak = Math.max(peak, ++active);
        await new Promise((r) => setTimeout(r, 10));
        active--;
      });
    const runs = Array.from({ length: 5 }, task);
    await expect(task()).rejects.toThrow(/ocupado/);
    await Promise.all(runs);
    expect(peak).toBe(2);
  });
});

describe('IP real atrás de proxy', () => {
  const nginx = new TrustedProxies(['127.0.0.1', '10.0.0.0/8']);

  it('sem proxies na lista vale o IP da conexão, com qualquer X-Forwarded-For', () => {
    expect(clientIp('203.0.113.9', '1.2.3.4', new TrustedProxies([]))).toBe('203.0.113.9');
  });

  it('atrás do proxy, o cliente é o último endereço que não é proxy', () => {
    expect(clientIp('127.0.0.1', '6.6.6.6, 1.2.3.4', nginx)).toBe('1.2.3.4');
    expect(clientIp('127.0.0.1', '1.2.3.4, 10.1.2.3', nginx)).toBe('1.2.3.4');
    expect(clientIp('::ffff:127.0.0.1', ['1.2.3.4'], nginx)).toBe('1.2.3.4');
  });

  it('quem fala direto com o servidor não finge outro IP pelo X-Forwarded-For', () => {
    expect(clientIp('203.0.113.9', '127.0.0.1, 1.2.3.4', nginx)).toBe('203.0.113.9');
  });

  it('endereços e faixas inválidos são recusados', () => {
    expect(() => new TrustedProxies(['nao-e-ip'])).toThrow();
    expect(() => new TrustedProxies(['10.0.0.0/33'])).toThrow();
  });
});

describe('configuração', () => {
  const base = { TOKEN_SECRET: secret(), PASSWORD_PEPPER: secret() };

  it('recusa segredos de exemplo ou curtos', () => {
    expect(() => loadConfig({ ...base, TOKEN_SECRET: 'troque-este-valor-com-npm-run-setup-xxxxxx' })).toThrow(/exemplo/);
    expect(() => loadConfig({ ...base, PASSWORD_PEPPER: 'curto' })).toThrow(/32/);
  });

  it('pimentas anteriores: "versão:segredo", únicas e diferentes da atual', () => {
    const old = secret();
    const config = loadConfig({ ...base, PASSWORD_PEPPER_VERSION: '2', PASSWORD_PEPPERS_PREVIOUS: `1:${old}` });
    expect(config.peppers.version).toBe(2);
    expect(config.peppers.previous?.get(1)).toBe(old);
    expect(() => loadConfig({ ...base, PASSWORD_PEPPERS_PREVIOUS: `1:${old}` })).toThrow(/diferentes da atual/);
    expect(() => loadConfig({ ...base, PASSWORD_PEPPER_VERSION: '2', PASSWORD_PEPPERS_PREVIOUS: '1:curto' })).toThrow(/32/);
  });

  it('recusa curinga e caminhos em ALLOWED_ORIGINS', () => {
    expect(() => loadConfig({ ...base, ALLOWED_ORIGINS: '*' })).toThrow(/curinga/);
    expect(() => loadConfig({ ...base, ALLOWED_ORIGINS: 'http://a.com/caminho' })).toThrow(/origem/);
  });

  it('em produção exige HTTPS, cookie seguro e sem ferramentas de teste', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', ALLOWED_ORIGINS: 'http://a.com' })).toThrow(/HTTPS/);
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://a.com', DEV_TOOLS: 'true' })).toThrow(/DEV_TOOLS/);
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://a.com', COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/);
    expect(loadConfig({ ...base, NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://a.com' }).isProduction).toBe(true);
  });

  it('padrão seguro: só localhost, cookie Secure, limites ligados', () => {
    const config = loadConfig(base);
    expect(config.HOST).toBe('127.0.0.1');
    expect(config.COOKIE_SECURE).toBe(true);
    expect(config.RATE_LIMIT).toBe(true);
    expect(config.DEV_TOOLS).toBe(false);
    expect(config.trustedProxies.entries).toEqual([]);
  });

  it('TRUST_PROXY antigo (confiava em qualquer X-Forwarded-For) é recusado, exceto desligado', () => {
    expect(() => loadConfig({ ...base, TRUST_PROXY: 'true' })).toThrow(/TRUSTED_PROXIES/);
    expect(loadConfig({ ...base, TRUST_PROXY: 'false', TRUSTED_PROXIES: '127.0.0.1' }).trustedProxies.entries).toEqual(['127.0.0.1']);
    expect(() => loadConfig({ ...base, TRUSTED_PROXIES: '0.0.0.0/99' })).toThrow(/TRUSTED_PROXIES/);
  });
});
