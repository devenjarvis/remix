import { beforeAll, describe, expect, it } from 'vitest';
import { getManifold, manifold } from '../../src/core/manifold';
import { repairSmallDefects } from '../../src/core/repair';
import { bounds, fromManifold, isManifold, placeOnBed, weld } from '../../src/core/trimesh';
import { unweldedCube } from './trimesh.test';

beforeAll(() => getManifold());

describe('repairSmallDefects', () => {
  it('fills a missing triangle and drops a flipped duplicate', () => {
    const cube = weld(unweldedCube(10));
    const idx = Array.from(cube.indices);
    const missing = idx.splice(0, 3);
    idx.push(idx[3], idx[5], idx[4]);
    const broken = { positions: cube.positions, indices: Uint32Array.from(idx) };
    expect(isManifold(broken).ok).toBe(false);
    const { mesh, report } = repairSmallDefects(broken);
    expect(report.removedTriangles).toBe(1);
    expect(report.filledHoles).toBe(1);
    expect(report.filledTriangles).toBe(1);
    expect(isManifold(mesh)).toEqual({ ok: true, status: 'NoError' });
    expect(mesh.indices.length).toBe(cube.indices.length);
    expect(missing.length).toBe(3);
  });

  it('leaves a clean mesh alone', () => {
    const cube = weld(unweldedCube(10));
    const { mesh, report } = repairSmallDefects(cube);
    expect(report).toEqual({ removedTriangles: 0, filledHoles: 0, filledTriangles: 0 });
    expect(mesh.indices.length).toBe(36);
  });

  it('does not fill large holes', () => {
    const cyl = fromManifold(manifold().Manifold.cylinder(10, 5, 5, 64));
    const kept: number[] = [];
    for (let t = 0; t < cyl.indices.length; t += 3) {
      const onTop = [0, 1, 2].every((k) => cyl.positions[cyl.indices[t + k] * 3 + 2] > 9.99);
      if (!onTop) kept.push(cyl.indices[t], cyl.indices[t + 1], cyl.indices[t + 2]);
    }
    const { report } = repairSmallDefects({ positions: cyl.positions, indices: Uint32Array.from(kept) });
    expect(report.filledHoles).toBe(0);
  });
});

describe('placeOnBed', () => {
  it('centers XY and drops to z=0', () => {
    const raw = unweldedCube(10);
    const shifted = { positions: raw.positions.map((v, i) => v + [-234, 50, -20][i % 3]), indices: raw.indices };
    const b = bounds(placeOnBed(shifted));
    expect(b.min).toEqual([-5, -5, 0]);
    expect(b.max).toEqual([5, 5, 10]);
  });
});
