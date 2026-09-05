import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { getManifold, manifold } from '../../src/core/manifold';
import { parseFont, type Font } from '../../src/core/font';
import { applyOp } from '../../src/core/ops/registry';
import { textContours, textToManifold } from '../../src/core/ops/text';
import type { OpContext } from '../../src/core/ops/types';

let ctx: OpContext;
let font: Font;
beforeAll(async () => {
  const buf = readFileSync('public/fonts/Roboto-Regular.ttf');
  font = parseFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  ctx = { manifold: await getManifold(), font };
});

describe('text', () => {
  it('produces holes for O and 8 and stays manifold', () => {
    const contours = textContours('O8', font, 10);
    expect(contours.length).toBe(5);
    const m = textToManifold('O8', font, 10, 2);
    expect(m.status()).toBe('NoError');
    const bb = m.boundingBox();
    const box = (bb.max[0] - bb.min[0]) * (bb.max[1] - bb.min[1]) * (bb.max[2] - bb.min[2]);
    expect(m.volume()).toBeGreaterThan(0);
    expect(m.volume()).toBeLessThan(box);
    expect(bb.max[2] - bb.min[2]).toBeCloseTo(2);
    expect(bb.max[1] - bb.min[1]).toBeGreaterThan(6);
    expect(bb.max[1] - bb.min[1]).toBeLessThanOrEqual(10.01);
  });

  it('embosses A on the top of a cube, raising max z by depth', async () => {
    const cube = manifold().Manifold.cube([20, 20, 10]);
    const parts = await applyOp(
      [cube],
      { id: 't', type: 'text', text: 'A', height: 8, depth: 1.5, mode: 'emboss', origin: [10, 10, 10], normal: [0, 0, 1], rotation: 0 },
      ctx,
    );
    expect(parts.length).toBe(1);
    expect(parts[0].status()).toBe('NoError');
    expect(parts[0].boundingBox().max[2]).toBeCloseTo(11.5, 3);
    expect(parts[0].volume()).toBeGreaterThan(4000);
  });

  it('engraves into a side face without changing bounds', async () => {
    const cube = manifold().Manifold.cube([20, 20, 10]);
    const parts = await applyOp(
      [cube],
      { id: 't', type: 'text', text: 'v2', height: 5, depth: 1, mode: 'engrave', origin: [20, 10, 5], normal: [1, 0, 0], rotation: 0 },
      ctx,
    );
    expect(parts[0].status()).toBe('NoError');
    const bb = parts[0].boundingBox();
    expect(bb.max[0]).toBeCloseTo(20, 3);
    expect(parts[0].volume()).toBeLessThan(4000);
    expect(parts[0].volume()).toBeGreaterThan(3900);
  });

  it('fails clearly without a font', async () => {
    const cube = manifold().Manifold.cube([20, 20, 10]);
    await expect(
      applyOp([cube], { id: 't', type: 'text', text: 'x', height: 5, depth: 1, mode: 'emboss', origin: [0, 0, 0], normal: [0, 0, 1], rotation: 0 }, { manifold: ctx.manifold }),
    ).rejects.toThrow(/font/i);
  });
});

describe('text with no parts', () => {
  it('returns live embossed text', async () => {
    const parts = await applyOp([], { id: 't', type: 'text', text: 'A', height: 8, depth: 1, mode: 'emboss', origin: [0, 0, 0], normal: [0, 0, 1], rotation: 0 }, ctx);
    expect(parts.length).toBe(1);
    expect(parts[0].volume()).toBeGreaterThan(0);
  });
});
