import { beforeAll, describe, expect, it } from 'vitest';
import { getManifold, manifold } from '../../src/core/manifold';
import { fromManifold, weld } from '../../src/core/trimesh';
import type { TriMesh } from '../../src/core/types';
import { adjacencyOf, triangleNormals } from '../../src/core/select';
import { segmentMesh, selectSegment } from '../../src/core/segment';
import { unweldedCube } from './trimesh.test';

beforeAll(async () => {
  await getManifold();
});

function cube(): TriMesh {
  return weld(unweldedCube(10));
}

function triCount(m: TriMesh): number {
  return m.indices.length / 3;
}

function areas(m: TriMesh): Float32Array {
  const p = m.positions, idx = m.indices;
  const out = new Float32Array(idx.length / 3);
  for (let t = 0; t < out.length; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    out[t] = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return out;
}

function segmentCount(labels: Uint32Array): number {
  let max = -1;
  for (const l of labels) if (l > max) max = l;
  return max + 1;
}

function maxDeviationDeg(m: TriMesh, labels: Uint32Array): number {
  const normals = triangleNormals(m);
  const ar = areas(m);
  const count = segmentCount(labels);
  const sum = new Float64Array(count * 3);
  for (let t = 0; t < labels.length; t++) {
    const l = labels[t] * 3;
    sum[l] += normals[t * 3] * ar[t];
    sum[l + 1] += normals[t * 3 + 1] * ar[t];
    sum[l + 2] += normals[t * 3 + 2] * ar[t];
  }
  let worst = 0;
  for (let t = 0; t < labels.length; t++) {
    if (ar[t] === 0) continue;
    const l = labels[t] * 3;
    const len = Math.hypot(sum[l], sum[l + 1], sum[l + 2]);
    const d = (normals[t * 3] * sum[l] + normals[t * 3 + 1] * sum[l + 1] + normals[t * 3 + 2] * sum[l + 2]) / len;
    const deg = (Math.acos(Math.max(-1, Math.min(1, d))) * 180) / Math.PI;
    if (deg > worst) worst = deg;
  }
  return worst;
}

describe('segmentMesh', () => {
  it('a cube at 10° yields 6 segments of 2 triangles', () => {
    const m = cube();
    const labels = segmentMesh(m, 10);
    expect(labels.length).toBe(12);
    expect(segmentCount(labels)).toBe(6);
    const sizes = new Array(6).fill(0);
    for (const l of labels) sizes[l]++;
    expect(sizes).toEqual([2, 2, 2, 2, 2, 2]);
    expect(labels[0]).toBe(0);
  });

  it('a 64-gon cylinder at 20° keeps caps as single segments and splits the wall into at least 6 segments whose normals all lie within 20° of their mean', () => {
    const m = fromManifold(manifold().Manifold.cylinder(20, 3, 3, 64));
    const labels = segmentMesh(m, 20);
    const normals = triangleNormals(m);
    const topLabels = new Set<number>(), bottomLabels = new Set<number>(), wallLabels = new Set<number>();
    for (let t = 0; t < triCount(m); t++) {
      const nz = normals[t * 3 + 2];
      if (nz > 0.999) topLabels.add(labels[t]);
      else if (nz < -0.999) bottomLabels.add(labels[t]);
      else wallLabels.add(labels[t]);
    }
    expect(topLabels.size).toBe(1);
    expect(bottomLabels.size).toBe(1);
    expect(wallLabels.size).toBeGreaterThanOrEqual(6);
    for (const l of topLabels) expect(wallLabels.has(l)).toBe(false);
    for (const l of bottomLabels) expect(wallLabels.has(l)).toBe(false);
    expect(maxDeviationDeg(m, labels)).toBeLessThanOrEqual(20 + 1e-3);
  });

  it('a sphere at 30° gives segments with cone radius at most 30° and covers every triangle', () => {
    const m = fromManifold(manifold().Manifold.sphere(10, 64));
    const labels = segmentMesh(m, 30);
    expect(labels.length).toBe(triCount(m));
    const count = segmentCount(labels);
    expect(count).toBeGreaterThan(1);
    const seen = new Uint8Array(count);
    for (const l of labels) {
      expect(l).toBeLessThan(count);
      seen[l] = 1;
    }
    for (const s of seen) expect(s).toBe(1);
    expect(maxDeviationDeg(m, labels)).toBeLessThanOrEqual(30 + 1e-3);
  });

  it('segmentMesh returns the same array for the same mesh and tolerance', () => {
    const m = cube();
    const a = segmentMesh(m, 10);
    expect(segmentMesh(m, 10)).toBe(a);
    expect(segmentMesh(m, 50)).not.toBe(a);
    const sel = selectSegment(m, a, 5);
    expect(sel.length).toBe(2);
    expect(Array.from(sel)).toContain(5);
    for (let i = 1; i < sel.length; i++) expect(sel[i]).toBeGreaterThan(sel[i - 1]);
    for (const t of sel) expect(a[t]).toBe(a[5]);
    let total = 0;
    for (let t = 0; t < a.length; t++) if (a[t] === a[5]) total++;
    expect(total).toBe(sel.length);
  });

  it('segments a large sphere at 30° in under 1500 ms', () => {
    const m = fromManifold(manifold().Manifold.sphere(50, 600));
    const adj = adjacencyOf(m);
    const normals = triangleNormals(m);
    const start = performance.now();
    const labels = segmentMesh(m, 30, adj, normals);
    const ms = performance.now() - start;
    console.log(`segmentMesh: ${triCount(m)} triangles in ${ms.toFixed(1)} ms`);
    expect(triCount(m)).toBeGreaterThan(100000);
    expect(labels.length).toBe(triCount(m));
    expect(ms).toBeLessThan(1500);
  });
});
