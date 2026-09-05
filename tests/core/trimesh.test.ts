import { describe, expect, it } from 'vitest';
import type { TriMesh } from '../../src/core/types';
import { getManifold } from '../../src/core/manifold';
import { bounds, fromManifold, isManifold, mergeMeshes, placeOnBed, toManifold, validateMesh, weld } from '../../src/core/trimesh';
import { MAX_SLOTS, defaultPalette, hasPaint } from '../../src/core/color';

export function unweldedCube(size = 10): TriMesh {
  const s = size;
  const v: number[][] = [
    [0, 0, 0], [s, 0, 0], [s, s, 0], [0, s, 0],
    [0, 0, s], [s, 0, s], [s, s, s], [0, s, s],
  ];
  const faces: number[][] = [
    [0, 3, 2], [0, 2, 1],
    [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4],
    [1, 2, 6], [1, 6, 5],
    [2, 3, 7], [2, 7, 6],
    [3, 0, 4], [3, 4, 7],
  ];
  const positions = new Float32Array(faces.length * 9);
  const indices = new Uint32Array(faces.length * 3);
  faces.forEach((f, i) => {
    f.forEach((vi, j) => {
      positions.set(v[vi], (i * 3 + j) * 3);
      indices[i * 3 + j] = i * 3 + j;
    });
  });
  return { positions, indices };
}

describe('trimesh', () => {
  it('welds 36 vertices down to 8', () => {
    const raw = unweldedCube();
    expect(raw.positions.length / 3).toBe(36);
    const w = weld(raw);
    expect(w.positions.length / 3).toBe(8);
    expect(w.indices.length).toBe(36);
  });

  it('computes bounds', () => {
    const b = bounds(unweldedCube());
    expect(b.min).toEqual([0, 0, 0]);
    expect(b.max).toEqual([10, 10, 10]);
    expect(b.size).toEqual([10, 10, 10]);
  });

  it('round-trips through Manifold with NoError and volume 1000', async () => {
    await getManifold();
    const m = toManifold(unweldedCube());
    expect(m.status()).toBe('NoError');
    expect(m.volume()).toBeCloseTo(1000, 3);
    const back = fromManifold(m);
    expect(back.indices.length / 3).toBe(12);
    expect(bounds(back).size).toEqual([10, 10, 10]);
  });

  it('reports manifold status', async () => {
    await getManifold();
    expect(isManifold(unweldedCube())).toEqual({ ok: true, status: 'NoError' });
    const open = unweldedCube();
    const holed: TriMesh = { positions: open.positions, indices: open.indices.slice(0, 33) };
    const r = isManifold(holed);
    expect(r.ok).toBe(false);
    expect(r.status).toMatch(/not manifold/i);
  });
});

describe('trimesh colors', () => {
  it('weld keeps colors aligned after dropping degenerate triangles', () => {
    const raw = unweldedCube();
    const indices = new Uint32Array(raw.indices.length + 3);
    indices.set(raw.indices.subarray(0, 3), 0);
    indices.set([0, 0, 1], 3);
    indices.set(raw.indices.subarray(3), 6);
    const colors = new Uint8Array(13);
    colors[0] = 1;
    colors[1] = 9;
    colors[2] = 2;
    const w = weld({ positions: raw.positions, indices, colors });
    expect(w.indices.length / 3).toBe(12);
    expect(Array.from(w.colors!.subarray(0, 3))).toEqual([1, 2, 0]);
  });

  it('weld returns no colors when the input has none', () => {
    expect(weld(unweldedCube()).colors).toBeUndefined();
  });

  it('mergeMeshes concatenates colors and fills missing with 0', () => {
    const a = unweldedCube();
    const b = unweldedCube();
    const colors = new Uint8Array(12).fill(3);
    const m = mergeMeshes([a, { ...b, colors }]);
    expect(m.colors!.length).toBe(24);
    expect(Array.from(m.colors!.subarray(0, 12)).every((c) => c === 0)).toBe(true);
    expect(Array.from(m.colors!.subarray(12)).every((c) => c === 3)).toBe(true);
    expect(mergeMeshes([a, b]).colors).toBeUndefined();
  });

  it('validateMesh rejects a colors array of the wrong length or with a slot above 16', () => {
    const cube = unweldedCube();
    expect(() => validateMesh({ ...cube, colors: new Uint8Array(11) })).toThrow(/color/i);
    const high = new Uint8Array(12);
    high[4] = 17;
    expect(() => validateMesh({ ...cube, colors: high })).toThrow(/color/i);
    expect(validateMesh({ ...cube, colors: new Uint8Array(12).fill(16) }).colors!.length).toBe(12);
  });

  it('placeOnBed keeps colors', () => {
    const cube = unweldedCube();
    const colors = new Uint8Array(12).fill(2);
    expect(placeOnBed({ ...cube, colors }).colors).toBe(colors);
  });

  it('hasPaint is true only when a slot is non-zero', () => {
    const cube = unweldedCube();
    expect(hasPaint(cube)).toBe(false);
    expect(hasPaint({ ...cube, colors: new Uint8Array(12) })).toBe(false);
    const c = new Uint8Array(12);
    c[5] = 1;
    expect(hasPaint({ ...cube, colors: c })).toBe(true);
  });

  it('defaultPalette has Base plus four distinct slots', () => {
    const p = defaultPalette();
    expect(p.length).toBe(5);
    expect(p[0].name).toBe('Base');
    expect(new Set(p.map((s) => s.hex)).size).toBe(5);
    for (const s of p) expect(s.hex).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(MAX_SLOTS).toBe(16);
  });
});
