import { describe, expect, it } from 'vitest';
import { loginNameOf, validGuestName } from '../src/lib/login-name';

/** Nome de entrada do convidado: o nome da mesa, comparado sem maiúsculas, acentos e espaços extras. */
describe('nome de entrada', () => {
  it('normaliza acentos, maiúsculas e espaços', () => {
    expect(loginNameOf(' Lýra  da  Silva ')).toBe('lyra da silva');
    expect(loginNameOf('LYRA')).toBe(loginNameOf('lyra'));
    expect(loginNameOf('Ação')).toBe('acao');
  });

  it('nome de convidado não pode ter @ nem ser só espaços', () => {
    expect(validGuestName('a@b')).toBe(false);
    expect(validGuestName('   ')).toBe(false);
    expect(validGuestName('Bia')).toBe(true);
  });
});
