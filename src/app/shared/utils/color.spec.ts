import { TAG_COLORS } from '../../core/models/tag.model';
import { readableTextOn } from './color';

describe('readableTextOn', () => {
  it('texto branco no preto e escuro no branco', () => {
    expect(readableTextOn('#000000')).toBe('#ffffff');
    expect(readableTextOn('#000')).toBe('#ffffff');
    expect(readableTextOn('#e8eefc')).toBe('#04060c');
  });

  it('as cores claras da paleta continuam com texto escuro', () => {
    for (const color of ['#eab308', '#22c55e', '#2dd4bf', '#f472b6']) expect(readableTextOn(color)).toBe('#04060c');
    expect(TAG_COLORS).toContain('#000000');
  });

  it('cor que não é hex usa texto escuro', () => {
    expect(readableTextOn('red')).toBe('#04060c');
  });
});
