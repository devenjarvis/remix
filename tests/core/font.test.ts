import { describe, expect, it } from 'vitest';
import { FONT_URL, fontUrl } from '../../src/core/font';

describe('fontUrl', () => {
  it('joins the base with exactly one slash', () => {
    expect(fontUrl('./')).toBe('./fonts/Roboto-Regular.ttf');
    expect(fontUrl('/')).toBe('/fonts/Roboto-Regular.ttf');
    expect(fontUrl('/remix/')).toBe('/remix/fonts/Roboto-Regular.ttf');
    expect(fontUrl('/remix')).toBe('/remix/fonts/Roboto-Regular.ttf');
  });
});

describe('FONT_URL', () => {
  it('is built from the Vite base URL', () => {
    expect(FONT_URL).toBe(fontUrl(import.meta.env.BASE_URL));
    expect(FONT_URL.endsWith('fonts/Roboto-Regular.ttf')).toBe(true);
  });
});
