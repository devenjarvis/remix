/**
 * Bambu Studio `paint_color` codec for unsplit triangles. The attribute is a
 * string of hex nibbles written in reverse order. The first nibble read (the
 * last character) carries the split count in its low two bits and the state in
 * its high two bits; a state of 3 means "3 plus the following nibbles", where
 * each 0xF nibble adds 15 and the first non-0xF nibble adds its value and ends
 * the code. Split triangles (low bits set, or leftover nibbles) decode to null.
 */
export function encodePaintColor(slot: number): string {
  if (slot < 3) return (slot << 2).toString(16).toUpperCase();
  const nibbles = [0xc];
  let rest = slot - 3;
  while (rest >= 15) {
    nibbles.push(0xf);
    rest -= 15;
  }
  nibbles.push(rest);
  return nibbles.reverse().map((n) => n.toString(16).toUpperCase()).join('');
}

/** Returns the filament state of an unsplit `paint_color` code, 0 for empty or unpainted, null for a split or invalid code. */
export function decodePaintColor(s: string): number | null {
  if (s === '') return 0;
  if (!/^[0-9a-fA-F]+$/.test(s)) return null;
  const nibbles = [...s].reverse().map((c) => parseInt(c, 16));
  const first = nibbles[0];
  if (first & 0x3) return null;
  let state = first >> 2;
  let i = 1;
  if (state === 3) {
    for (;;) {
      if (i >= nibbles.length) return null;
      const n = nibbles[i++];
      state += n;
      if (n !== 0xf) break;
    }
  }
  return i === nibbles.length ? state : null;
}

/** Normalizes a 3MF color string ("#RRGGBB" or "#RRGGBBAA") to uppercase "#RRGGBB". */
export function normalizeHex(s: string): string | undefined {
  const m = /^#([0-9a-fA-F]{6})/.exec(s.trim());
  return m ? `#${m[1].toUpperCase()}` : undefined;
}

/** Collects `m:colorgroup` and `basematerials` resources keyed by id, each an ordered list of "#RRGGBB" strings. */
export function parseColorTable(xml: string): Map<string, string[]> {
  const table = new Map<string, string[]>();
  const add = (id: string | undefined, hexes: (string | undefined)[]) => {
    if (id) table.set(id, hexes.map((h) => h ?? '#000000'));
  };
  for (const g of xml.matchAll(/<(?:m:)?colorgroup\b([^>]*)>([\s\S]*?)<\/(?:m:)?colorgroup>/g)) {
    const hexes = [...g[2].matchAll(/<(?:m:)?color\b[^>]*>/g)].map((c) => normalizeHex(attr(c[0], 'color') ?? ''));
    add(attr(g[1], 'id'), hexes);
  }
  for (const g of xml.matchAll(/<basematerials\b([^>]*)>([\s\S]*?)<\/basematerials>/g)) {
    const hexes = [...g[2].matchAll(/<base\b[^>]*>/g)].map((c) => normalizeHex(attr(c[0], 'displaycolor') ?? ''));
    add(attr(g[1], 'id'), hexes);
  }
  return table;
}

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
}
