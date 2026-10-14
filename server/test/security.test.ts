import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env';
import { isSafeId } from '../src/lib/ids';
import { Semaphore, TokenBucket, WindowLimiter } from '../src/lib/limiter';
import { parseJsonSafely, unsafeJsonReason } from '../src/lib/safe-json';
import { detectFileType } from '../src/security/file-type';
import { isAllowedOrigin } from '../src/security/origin';
import { PasswordHasher, passwordProblem } from '../src/security/password';
import { TokenService } from '../src/security/tokens';
import { PNG_1X1 } from './helpers';

const secret = () => randomBytes(32).toString('hex');

describe('senhas (scrypt + pimenta)', () => {
  const hasher = new PasswordHasher(secret(), 14);
  const password = randomBytes(12).toString('base64url');

  it('confere a senha certa e recusa a errada', async () => {
    const hash = await hasher.hash(password);
    expect(hash.startsWith('scrypt$14$8$1$')).toBe(true);
    expect(await hasher.verify(password, hash)).toBe(true);
    expect(await hasher.verify(`${password}x`, hash)).toBe(false);
  });

  it('o mesmo texto gera hashes diferentes (sal aleatório)', async () => {
    expect(await hasher.hash(password)).not.toBe(await hasher.hash(password));
  });

  it('sem a pimenta certa, o hash não confere (vazar só o banco não basta)', async () => {
    const hash = await hasher.hash(password);
    expect(await new PasswordHasher(secret(), 14).verify(password, hash)).toBe(false);
  });

  it('hash malformado não lança, só recusa', async () => {
    for (const bad of ['', 'scrypt$', 'bcrypt$1$2$3$4$5', 'scrypt$99$8$1$AA$AA', 'scrypt$14$8$1$AA$AA']) {
      expect(await hasher.verify(password, bad)).toBe(false);
    }
  });

  it('pede novo hash quando o custo muda', async () => {
    const hash = await hasher.hash(password);
    expect(hasher.needsRehash(hash)).toBe(false);
    expect(new PasswordHasher(secret(), 15).needsRehash(hash)).toBe(true);
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

describe('configuração', () => {
  const base = { TOKEN_SECRET: secret(), PASSWORD_PEPPER: secret() };

  it('recusa segredos de exemplo ou curtos', () => {
    expect(() => loadConfig({ ...base, TOKEN_SECRET: 'troque-este-valor-com-npm-run-setup-xxxxxx' })).toThrow(/exemplo/);
    expect(() => loadConfig({ ...base, PASSWORD_PEPPER: 'curto' })).toThrow(/32/);
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
  });
});
