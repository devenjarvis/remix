import { beforeAll, describe, expect, it } from 'vitest';
import { getManifold, manifold } from '../../src/core/manifold';
import { fromManifold, toManifold, weld } from '../../src/core/trimesh';
import { triangleCentroid, triangleNormals } from '../../src/core/select';
import { splitByField } from '../../src/core/sharpen';
import { buildBvh, occluded } from '../../src/core/bvh';
import { lassoField, selectLasso } from '../../src/core/lasso';
import type { TriMesh, Vec3 } from '../../src/core/types';
import { unweldedCube } from './trimesh.test';

beforeAll(() => getManifold());

const cube = () => weld(unweldedCube(10));
const refinedCube = () => fromManifold(manifold().Manifold.cube([10, 10, 10]).refineToLength(1));

const EYE: Vec3 = [5, 5, 50];
const square = (lo: number, hi: number, z: number): Vec3[] => [[lo, lo, z], [hi, lo, z], [hi, hi, z], [lo, hi, z]];

/** Projects a point from EYE onto the plane z = 20 and returns its xy. */
function projectTo20(p: Vec3): [number, number] {
  const s = (50 - 20) / (50 - p[2]);
  return [5 + s * (p[0] - 5), 5 + s * (p[1] - 5)];
}

function trianglesWhere(m: TriMesh, pred: (n: number[], c: Vec3, t: number) => boolean): number[] {
  const n = triangleNormals(m);
  const out: number[] = [];
  for (let t = 0; t < m.indices.length / 3; t++) {
    if (pred([n[t * 3], n[t * 3 + 1], n[t * 3 + 2]], triangleCentroid(m, t), t)) out.push(t);
  }
  return out;
}

describe('lasso', () => {
  it('occluded sees the far side of a cube behind the near face', () => {
    const m = cube();
    const bvh = buildBvh(m);
    const bottom = trianglesWhere(m, (n) => n[2] < -0.9)[0];
    const top = trianglesWhere(m, (n) => n[2] > 0.9)[0];
    expect(occluded(bvh, m, EYE, triangleCentroid(m, bottom), bottom)).toBe(true);
    expect(occluded(bvh, m, EYE, triangleCentroid(m, top), top)).toBe(false);
    expect(occluded(bvh, m, [20, 20, 50], [20, 20, -10], -1)).toBe(false);
  });

  it('a square lasso from +z over the cube top selects only top triangles inside the square', () => {
    const m = refinedCube();
    const polygon = square(2, 8, 20);
    const field = lassoField(m, EYE, polygon);
    const top = trianglesWhere(m, (n) => n[2] > 0.9);
    expect(top.length).toBeGreaterThan(100);
    let checked = 0;
    for (const t of top) {
      for (let k = 0; k < 3; k++) {
        const v = m.indices[t * 3 + k];
        const [x, y] = projectTo20([m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]]);
        const margin = Math.min(x - 2, 8 - x, y - 2, 8 - y);
        if (Math.abs(margin) < 1e-3) continue;
        checked++;
        expect(Math.sign(field[t * 3 + k])).toBe(Math.sign(margin));
      }
    }
    expect(checked).toBeGreaterThan(100);

    const picked = selectLasso(m, EYE, polygon);
    const topSet = new Set(top);
    const inside = (c: Vec3, margin: number): boolean => {
      const [x, y] = projectTo20(c);
      return x > 2 + margin && x < 8 - margin && y > 2 + margin && y < 8 - margin;
    };
    for (const t of picked) {
      expect(topSet.has(t)).toBe(true);
      expect(inside(triangleCentroid(m, t), -1e-3)).toBe(true);
    }
    const pickedSet = new Set(picked);
    const expected = top.filter((t) => inside(triangleCentroid(m, t), 1e-3));
    expect(expected.length).toBeGreaterThan(50);
    for (const t of expected) expect(pickedSet.has(t)).toBe(true);
    for (let i = 1; i < picked.length; i++) expect(picked[i]).toBeGreaterThan(picked[i - 1]);
  });

  it('a lasso around a cylinder wall from the side selects front wall triangles and none from the back', () => {
    const cyl = manifold().Manifold.cylinder(20, 3, 3, 64);
    const m = fromManifold(cyl);
    cyl.delete();
    const eye: Vec3 = [60, 0, 10];
    const polygon: Vec3[] = [[20, -5, 2], [20, 5, 2], [20, 5, 18], [20, -5, 18]];
    const picked = selectLasso(m, eye, polygon);
    expect(picked.length).toBeGreaterThan(10);
    const n = triangleNormals(m);
    for (const t of picked) {
      expect(Math.abs(n[t * 3 + 2])).toBeLessThan(0.01);
      expect(triangleCentroid(m, t)[0]).toBeGreaterThan(0);
    }
  });

  it('lassoField then splitByField on a refined cube top ends on the square', () => {
    const m = refinedCube();
    const polygon = square(2.3, 7.7, 20);
    const lo = 5 + (2.3 - 5) / 0.75, hi = 5 + (7.7 - 5) / 0.75;
    const { mesh } = splitByField(m, lassoField(m, EYE, polygon));
    expect(mesh.positions.length).toBeGreaterThan(m.positions.length);
    let onTop = 0;
    for (let v = m.positions.length; v < mesh.positions.length; v += 3) {
      const x = mesh.positions[v], y = mesh.positions[v + 1], z = mesh.positions[v + 2];
      if (z < 9.99) continue;
      onTop++;
      const onLine = Math.min(Math.abs(x - lo), Math.abs(x - hi), Math.abs(y - lo), Math.abs(y - hi));
      const cornerDist = Math.min(...[lo, hi].flatMap((cx) => [lo, hi].map((cy) => Math.hypot(x - cx, y - cy))));
      // Within one mesh edge of a convex corner the outside distance is radial, so interpolated crossings drift slightly.
      expect(onLine).toBeLessThan(cornerDist < 1 ? 0.05 : 1e-3);
    }
    expect(onTop).toBeGreaterThan(20);
    const mf = toManifold(mesh);
    expect(mf.status()).toBe('NoError');
    expect(mf.volume()).toBeCloseTo(1000, 3);
    mf.delete();
  });

  it('builds a BVH and lassos a 320k-triangle sphere within budget', () => {
    const sphere = manifold().Manifold.sphere(50, 600);
    const m = fromManifold(sphere);
    sphere.delete();
    const numTri = m.indices.length / 3;
    let t0 = performance.now();
    const bvh = buildBvh(m);
    const buildMs = performance.now() - t0;
    console.log(`buildBvh: ${numTri} triangles in ${buildMs.toFixed(1)} ms`);
    expect(buildMs).toBeLessThan(400);

    const normals = triangleNormals(m);
    t0 = performance.now();
    const picked = selectLasso(m, [0, 0, 300], square(-40, 40, 100), normals, bvh);
    const lassoMs = performance.now() - t0;
    console.log(`selectLasso: ${picked.length} of ${numTri} triangles in ${lassoMs.toFixed(1)} ms`);
    expect(lassoMs).toBeLessThan(600);
    expect(picked.length).toBeGreaterThan(1000);
    for (const t of picked) expect(normals[t * 3 + 2]).toBeGreaterThanOrEqual(0);
  });
});
