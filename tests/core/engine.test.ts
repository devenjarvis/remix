import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { Engine } from '../../src/core/engine';
import { parseFont } from '../../src/core/font';
import { History } from '../../src/core/history';
import { getManifold } from '../../src/core/manifold';
import { unweldedCube } from './trimesh.test';

let engine: Engine;
beforeAll(async () => {
  await getManifold();
  engine = new Engine();
  const buf = readFileSync('public/fonts/Roboto-Regular.ttf');
  engine.font = parseFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
});

describe('engine cache lifecycle', () => {
  it('survives undo of an op that passed a part through by reference', async () => {
    engine.setSource(unweldedCube(10));
    const h = new History();
    h.push({ id: '1', type: 'scale', factors: [2, 2, 2] });
    h.push({ id: '2', type: 'cut', axis: 'z', offset: 5, keep: 'both' });
    h.push({ id: '3', type: 'text', text: 'OK', height: 8, depth: 1, mode: 'emboss', origin: [10, 0, 9], normal: [0, -1, 0], rotation: 0 });
    const r = await engine.evaluate(h);
    expect(r.error).toBeUndefined();
    expect(r.parts.length).toBe(2);

    h.undo();
    const r2 = await engine.evaluate(h);
    expect(r2.error).toBeUndefined();
    expect(r2.parts.length).toBe(2);
    expect(r2.parts.reduce((s, p) => s + p.indices.length / 3, 0)).toBe(24);

    h.redo();
    const r3 = await engine.evaluate(h);
    expect(r3.error).toBeUndefined();
    expect(r3.parts.reduce((s, p) => s + p.indices.length / 3, 0)).toBe(r.parts.reduce((s, p) => s + p.indices.length / 3, 0));

    h.remove('2');
    const r4 = await engine.evaluate(h);
    expect(r4.error).toBeUndefined();
    expect(r4.parts.length).toBe(1);
  });

  it('survives undo of a union that passed parts through', async () => {
    engine.setSource(unweldedCube(10));
    const h = new History();
    h.push({ id: '1', type: 'cut', axis: 'x', offset: 5, keep: 'both' });
    h.push({ id: '2', type: 'boolean', mode: 'union', tool: { kind: 'box', size: [2, 2, 2] }, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1] });
    expect((await engine.evaluate(h)).error).toBeUndefined();
    h.undo();
    expect((await engine.evaluate(h)).error).toBeUndefined();
    engine.setSource(unweldedCube(5));
    expect((await engine.evaluate(h)).error).toBeUndefined();
  });
});
