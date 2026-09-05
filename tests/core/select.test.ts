import { beforeAll, describe, expect, it } from 'vitest';
import { getManifold, manifold } from '../../src/core/manifold';
import { fromManifold, weld } from '../../src/core/trimesh';
import type { TriMesh, Vec3 } from '../../src/core/types';
import {
  adjacencyOf,
  buildAdjacency,
  nearestTriangle,
  selectBrush,
  selectFill,
  selectHeight,
  triangleCentroid,
  triangleNormals,
} from '../../src/core/select';
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

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

describe('select', () => {
  it('builds adjacency with every edge shared on a closed cube', () => {
    const m = cube();
    const adj = buildAdjacency(m);
    expect(adj.length).toBe(36);
    for (const n of adj) expect(n).toBeGreaterThanOrEqual(0);
  });

  it('fill at 1° selects exactly the two triangles of one cube face', () => {
    const m = cube();
    const adj = buildAdjacency(m);
    const normals = triangleNormals(m);
    const sel = selectFill(m, adj, 0, 1);
    expect(sel.length).toBe(2);
    for (const t of sel) {
      expect(normals[t * 3]).toBeCloseTo(normals[0], 5);
      expect(normals[t * 3 + 1]).toBeCloseTo(normals[1], 5);
      expect(normals[t * 3 + 2]).toBeCloseTo(normals[2], 5);
    }
  });

  it('fill at 100° from a cube face selects every face but the opposite one; 180° selects the whole cube', () => {
    const m = cube();
    const adj = buildAdjacency(m);
    const normals = triangleNormals(m);
    const sel = selectFill(m, adj, 0, 100);
    expect(sel.length).toBe(10);
    for (const t of sel) expect(normals[t * 3 + 2]).toBeLessThan(0.5);
    expect(Array.from(selectFill(m, adj, 0, 180))).toEqual([...Array(12).keys()]);
  });

  it('brush of radius 8 at a corner selects only triangles touching that corner', () => {
    const m = cube();
    const adj = buildAdjacency(m);
    const corner: Vec3 = [0, 0, 0];
    const radius = 8;
    let seed = -1;
    for (let t = 0; t < triCount(m) && seed < 0; t++) {
      for (let k = 0; k < 3; k++) {
        const v = m.indices[t * 3 + k];
        if (dist([m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]], corner) < 1e-6) seed = t;
      }
    }
    expect(seed).toBeGreaterThanOrEqual(0);
    const expected: number[] = [];
    for (let t = 0; t < triCount(m); t++) {
      if (dist(triangleCentroid(m, t), corner) <= radius) expected.push(t);
    }
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(12);
    const sel = selectBrush(m, adj, [seed], [corner], radius);
    expect(Array.from(sel)).toEqual(expected);
    for (const t of sel) {
      let touches = false;
      for (let k = 0; k < 3; k++) {
        const v = m.indices[t * 3 + k];
        if (dist([m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]], corner) < 1e-6) touches = true;
      }
      expect(touches).toBe(true);
    }
    expect(selectBrush(m, adj, [-1], [corner], radius).length).toBe(0);
  });

  it('height 0..5 selects triangles with centroid z in range', () => {
    const m = cube();
    const expected: number[] = [];
    for (let t = 0; t < triCount(m); t++) {
      const z = triangleCentroid(m, t)[2];
      if (z >= 0 && z <= 5) expected.push(t);
    }
    expect(expected.length).toBe(6);
    expect(Array.from(selectHeight(m, 0, 5))).toEqual(expected);
  });

  it('nearestTriangle returns -1 for a point 5 mm off the surface', () => {
    const m = cube();
    expect(nearestTriangle(m, [5, 5, 15], [0, 0, 1])).toBe(-1);
  });

  it('nearestTriangle finds the top face only with a matching normal', () => {
    const m = cube();
    const normals = triangleNormals(m);
    const t = nearestTriangle(m, [5, 5, 10], [0, 0, 1]);
    expect(t).toBeGreaterThanOrEqual(0);
    expect(normals[t * 3 + 2]).toBeCloseTo(1, 5);
    expect(triangleCentroid(m, t)[2]).toBeCloseTo(10, 5);
    expect(nearestTriangle(m, [5, 5, 10], [0, 0, -1])).toBe(-1);
  });

  it('fill on a cube unioned with a cylinder at 30° selects the cylinder wall but not the caps', () => {
    const { Manifold } = manifold();
    const shape = Manifold.cube([10, 10, 10]).add(Manifold.cylinder(20, 3, 3, 64).translate([5, 5, 5]));
    const m = fromManifold(shape);
    const adj = buildAdjacency(m);
    const normals = triangleNormals(m);
    let wall = 0;
    for (let t = 0; t < triCount(m); t++) {
      const c = triangleCentroid(m, t);
      if (Math.abs(normals[t * 3 + 2]) < 0.01 && c[2] > 10.5 && Math.hypot(c[0] - 5, c[1] - 5) < 3.5) wall++;
    }
    const seed = nearestTriangle(m, [8, 5, 20], [1, 0, 0]);
    expect(seed).toBeGreaterThanOrEqual(0);
    const sel = selectFill(m, adj, seed, 30);
    expect(sel.length).toBeGreaterThan(2);
    expect(sel.length).toBeLessThan(wall);
    for (const t of sel) {
      expect(Math.abs(normals[t * 3 + 2])).toBeLessThan(0.01);
      expect(triangleCentroid(m, t)[2]).toBeGreaterThan(10.5);
    }
  });

  it('builds adjacency for a large sphere in under 3 seconds', () => {
    const m = fromManifold(manifold().Manifold.sphere(50, 600));
    const start = performance.now();
    const adj = buildAdjacency(m);
    const ms = performance.now() - start;
    console.log(`buildAdjacency: ${triCount(m)} triangles in ${ms.toFixed(1)} ms`);
    expect(triCount(m)).toBeGreaterThan(100000);
    expect(adj.length).toBe(m.indices.length);
    expect(ms).toBeLessThan(3000);
  });
});

describe('adjacencyOf', () => {
  it('returns the same table for the same index array and a new one for a copy', () => {
    const cube = weld(unweldedCube(10));
    const a = adjacencyOf(cube);
    expect(adjacencyOf({ ...cube, colors: new Uint8Array(12) })).toBe(a);
    expect(adjacencyOf({ ...cube, indices: cube.indices.slice() })).not.toBe(a);
    expect(Array.from(a)).toEqual(Array.from(buildAdjacency(cube)));
  });
});
