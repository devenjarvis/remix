import opentype from 'opentype.js';
import type { Font } from 'opentype.js';

export type { Font };

let cached: Promise<Font> | null = null;

export function fontUrl(base: string): string {
  return `${base.endsWith('/') ? base : `${base}/`}fonts/Roboto-Regular.ttf`;
}

export const FONT_URL = fontUrl(import.meta.env.BASE_URL);

export function parseFont(data: ArrayBuffer): Font {
  return opentype.parse(data);
}

/** Fetches the bundled font in the browser. Tests call parseFont with bytes from disk instead. */
export function getFont(url = FONT_URL): Promise<Font> {
  if (!cached) {
    cached = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Font fetch failed: ${r.status}`);
        return r.arrayBuffer();
      })
      .then(parseFont);
  }
  return cached;
}
