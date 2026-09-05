import { describe, expect, it } from 'vitest';
import type { TriMesh } from '../../src/core/types';
import { getManifold } from '../../src/core/manifold';
import { bounds, fromManifold, isManifold, toManifold, weld } from '../../src/core/trimesh';

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
