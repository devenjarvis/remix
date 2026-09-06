import { describe, expect, it } from 'vitest';
import { decodePaintColor, encodePaintColor } from '../../src/io/color3mf';

describe('paint_color codec', () => {
  it('encodePaintColor gives 4, 8, 0C, 2C, 0FC for slots 1, 2, 3, 5, 18', () => {
    expect(encodePaintColor(1)).toBe('4');
    expect(encodePaintColor(2)).toBe('8');
    expect(encodePaintColor(3)).toBe('0C');
    expect(encodePaintColor(5)).toBe('2C');
    expect(encodePaintColor(18)).toBe('0FC');
  });

  it('decodePaintColor inverts encodePaintColor for slots 0 to 18 and returns null for a split code', () => {
    for (let s = 0; s <= 18; s++) expect(decodePaintColor(encodePaintColor(s))).toBe(s);
    expect(decodePaintColor('')).toBe(0);
    expect(decodePaintColor('0')).toBe(0);
    for (const split of ['1', '5D', '0C1D', 'C', '44', 'zz']) expect(decodePaintColor(split)).toBeNull();
  });
});
