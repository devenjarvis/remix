import { beforeAll, describe, expect, it } from 'vitest';
import { getManifold, manifold } from '../../src/core/manifold';
import { fromManifold, toManifold, weld } from '../../src/core/trimesh';
import { triangleCentroid, triangleNormals, vertexTriangles } from '../../src/core/select';
import { fractionField, planeField, splitByField } from '../../src/core/sharpen';
import type { TriMesh } from '../../src/core/types';
import { unweldedCube } from './trimesh.test';

beforeAll(() => getManifold());

const cube = () => weld(unweldedCube(10));

function centroidZ(m: TriMesh): number[] {
  const out: number[] = [];
  for (let t = 0; t < m.indices.length / 3; t++) out.push(triangleCentroid(m, t)[2]);
  return out;
}

function selectWhere(m: TriMesh, pred: (n: number[], c: number[]) => boolean): Uint8Array {
  const n = triangleNormals(m);
  const out = new Uint8Array(m.indices.length / 3);
  for (let t = 0; t < out.length; t++) {
    if (pred([n[t * 3], n[t * 3 + 1], n[t * 3 + 2]], triangleCentroid(m, t))) out[t] = 1;
  }
  return out;
}

function expectManifoldWithVolume(m: TriMesh, volume: number): void {
  const mf = toManifold(m);
  expect(mf.status()).toBe('NoError');
  expect(mf.volume()).toBeCloseTo(volume, 3);
  mf.delete();
}

describe('sharpen', () => {
  it('vertexTriangles lists every incident triangle once per corner', () => {
    const m = cube();
    const { offsets, incident } = vertexTriangles(m);
    expect(offsets.length).toBe(9);
    expect(incident.length).toBe(36);
    for (let v = 0; v < 8; v++) {
      for (let j = offsets[v]; j < offsets[v + 1]; j++) {
        const t = incident[j];
        expect([m.indices[t * 3], m.indices[t * 3 + 1], m.indices[t * 3 + 2]]).toContain(v);
      }
    }
  });

  it('planeField at z=5 splits the 8 side triangles of a cube into pieces that end on z=5', () => {
    const m = cube();
    const { mesh, source, inside } = splitByField(m, planeField(m, 5));
    expect(mesh.indices.length / 3).toBe(12 - 8 + 8 * 3);
    expect(mesh.positions.length / 3).toBe(8 + 8);
    for (let i = 2; i < mesh.positions.length; i += 3) expect([0, 5, 10]).toContain(mesh.positions[i]);
    expect(source.length).toBe(28);
    for (let t = 0; t < 28; t++) expect(source[t]).toBeLessThan(12);
    const zs = centroidZ(mesh);
    for (let t = 0; t < 28; t++) expect(inside[t]).toBe(zs[t] > 5 ? 1 : 0);
    expectManifoldWithVolume(mesh, 1000);
  });

  it('planeField outside the mesh returns the input arrays by reference', () => {
    const m = cube();
    const { mesh, source, inside } = splitByField(m, planeField(m, 0));
    expect(mesh.indices).toBe(m.indices);
    expect(mesh.positions).toBe(m.positions);
    expect(Array.from(source)).toEqual([...Array(12).keys()]);
    expect(inside.length).toBe(12);
  });

  it('fractionField keeps a crease boundary unsplit', () => {
    const m = cube();
    const selected = selectWhere(m, (n) => n[2] > 0.9);
    const field = fractionField(m, selected, triangleNormals(m), vertexTriangles(m));
    const { mesh, inside } = splitByField(m, field);
    expect(mesh.indices).toBe(m.indices);
    expect(Array.from(inside)).toEqual(Array.from(selected));
  });

  it('fractionField splits across a smooth boundary and stays manifold', () => {
    const cyl = manifold().Manifold.cylinder(20, 3, 3, 64).refineToLength(2);
    const m = fromManifold(cyl);
    const volume = cyl.volume();
    const selected = selectWhere(m, (n, c) => Math.abs(n[2]) < 0.01 && c[2] > 10);
    const field = fractionField(m, selected, triangleNormals(m), vertexTriangles(m));
    const { mesh, source, inside } = splitByField(m, field);
    expect(mesh.indices.length).toBeGreaterThan(m.indices.length);
    const inner = 3 * Math.cos(Math.PI / 64);
    for (let v = m.positions.length; v < mesh.positions.length; v += 3) {
      const r = Math.hypot(mesh.positions[v], mesh.positions[v + 1]);
      expect(r).toBeGreaterThan(inner - 1e-4);
      expect(r).toBeLessThan(3 + 1e-4);
      expect(mesh.positions[v + 2]).toBeGreaterThan(0);
      expect(mesh.positions[v + 2]).toBeLessThan(20);
    }
    for (let t = 0; t < source.length; t++) {
      if (m.indices.length / 3 > source[t] && !selected[source[t]] && inside[t]) {
        expect(triangleCentroid(mesh, t)[2]).toBeGreaterThan(8);
      }
    }
    const zs = centroidZ(mesh);
    const painted = zs.filter((_, t) => inside[t]);
    expect(Math.min(...painted)).toBeGreaterThan(7);
    expect(Math.max(...zs.filter((_, t) => !inside[t] && Math.abs(triangleNormals(mesh)[t * 3 + 2]) < 0.01))).toBeLessThan(13);
    expectManifoldWithVolume(mesh, volume);
    cyl.delete();
  });

  it('shared split edges reuse one vertex', () => {
    const m = cube();
    const { mesh } = splitByField(m, planeField(m, 5));
    const used = new Map<number, number>();
    for (const i of mesh.indices) used.set(i, (used.get(i) ?? 0) + 1);
    for (let v = 8; v < 16; v++) expect(used.get(v)).toBeGreaterThanOrEqual(2);
    const half = splitByField(mesh, planeField(mesh, 2.5));
    expect(half.mesh.positions.length / 3).toBe(16 + 12);
    expectManifoldWithVolume(half.mesh, 1000);
  });

  it('retriangulates forced splits from a neighbor into 2 and 4 pieces with winding kept', () => {
    const m: TriMesh = {
      positions: Float32Array.from([0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 2, 0]),
      indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
    };
    const field = Float32Array.from([1, -1, 1, -1, 1, 1]);
    const { mesh, source, inside } = splitByField(m, field);
    expect(mesh.positions.length / 3).toBe(8);
    expect(mesh.indices.length / 3).toBe(7);
    expect(Array.from(source).filter((s) => s === 0).length).toBe(4);
    expect(Array.from(source).filter((s) => s === 1).length).toBe(3);
    const n = triangleNormals(mesh);
    for (let t = 0; t < 7; t++) expect(n[t * 3 + 2]).toBeGreaterThan(0.99);
    for (let t = 0; t < 7; t++) {
      const c = triangleCentroid(mesh, t);
      if (source[t] === 0) expect(inside[t]).toBe(Math.hypot(c[0] - 2, c[1]) > 0.9 ? 1 : 0);
      else expect(inside[t]).toBe(Math.hypot(c[0], c[1]) > 0.9 ? 1 : 0);
    }
    const forcedOnly = splitByField(m, Float32Array.from([1, 1, 1, -1, 1, 1]));
    expect(forcedOnly.mesh.indices.length / 3).toBe(2 + 3);
    expect(Array.from(forcedOnly.inside).slice(0, 2)).toEqual([1, 1]);
  });

  it('remaps colors through source', () => {
    const m = cube();
    m.colors = new Uint8Array(12);
    m.colors[2] = 3;
    const { mesh, source } = splitByField(m, planeField(m, 5));
    for (let t = 0; t < source.length; t++) expect(mesh.colors![t]).toBe(m.colors[source[t]]);
  });

  it('a crossing within 2% of a vertex is not split', () => {
    const m: TriMesh = {
      positions: Float32Array.from([0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 2, 0]),
      indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
    };
    const near = splitByField(m, Float32Array.from([1, -0.01, -1, 1, -1, -1]));
    expect(near.mesh.positions.length / 3).toBe(6);
    for (let v = 4; v < 6; v++) expect(near.mesh.positions[v * 3 + 1]).toBeGreaterThan(0.5);
    expect(Array.from(near.source).filter((s) => s === 0).length).toBe(2);
    expect(Array.from(near.source).filter((s) => s === 1).length).toBe(3);
    const none = splitByField(m, Float32Array.from([1, -0.01, -0.01, 1, -0.01, -0.01]));
    expect(none.mesh.indices).toBe(m.indices);
    expect(Array.from(none.inside)).toEqual([1, 1]);
  });

  it('fractionField weights corners by angle so a thin sliver does not pull the contour', () => {
    const m: TriMesh = {
      positions: Float32Array.from([0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0, 0.5, 0.25, 0]),
      indices: Uint32Array.from([0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4]),
    };
    const selected = Uint8Array.from([1, 0, 0, 0]);
    const field = fractionField(m, selected, triangleNormals(m), vertexTriangles(m));
    const at4 = field[2] + 0.5;
    expect(at4).toBeGreaterThan(0.35);
    expect(at4).toBeLessThan(0.5);
  });
});
