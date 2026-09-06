import { beforeAll, describe, expect, it } from 'vitest';
import type { Manifold } from 'manifold-3d';
import { getManifold, manifold } from '../../src/core/manifold';
import { bakePaint, fromManifold, toManifold, weld, withPendingPaint, withSlot } from '../../src/core/trimesh';
import { hasPaint } from '../../src/core/color';
import { triangleNormals } from '../../src/core/select';
import type { TriMesh } from '../../src/core/types';
import { unweldedCube } from './trimesh.test';

beforeAll(() => getManifold());

/** Cube with top face (normal +z) in slot 1 and bottom face in slot 2. */
function paintedCube(): TriMesh {
  const cube = weld(unweldedCube(10));
  const n = triangleNormals(cube);
  const colors = new Uint8Array(12);
  for (let t = 0; t < 12; t++) {
    if (n[t * 3 + 2] > 0.9) colors[t] = 1;
    else if (n[t * 3 + 2] < -0.9) colors[t] = 2;
  }
  return { ...cube, colors };
}

/** Slots grouped by a predicate on (normal, centroid). */
function slotsWhere(m: TriMesh, pred: (n: number[], c: number[]) => boolean): number[] {
  const n = triangleNormals(m);
  const out: number[] = [];
  for (let t = 0; t < m.indices.length / 3; t++) {
    const c = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const v = m.indices[t * 3 + k] * 3;
      c[0] += m.positions[v] / 3;
      c[1] += m.positions[v + 1] / 3;
      c[2] += m.positions[v + 2] / 3;
    }
    if (pred([n[t * 3], n[t * 3 + 1], n[t * 3 + 2]], c)) out.push(m.colors?.[t] ?? 0);
  }
  return out;
}

const only = (values: number[], slot: number) => values.length > 0 && values.every((v) => v === slot);

describe('color slots through manifold', () => {
  it('toManifold then fromManifold round-trips colors on a cube with two slots', () => {
    const m = toManifold(paintedCube());
    expect(m.status()).toBe('NoError');
    const back = fromManifold(m);
    expect(back.indices.length / 3).toBe(12);
    expect(only(slotsWhere(back, (n) => n[2] > 0.9), 1)).toBe(true);
    expect(only(slotsWhere(back, (n) => n[2] < -0.9), 2)).toBe(true);
    expect(only(slotsWhere(back, (n) => Math.abs(n[2]) < 0.1), 0)).toBe(true);
    m.delete();
  });

  it('returns no colors for an unpainted mesh', () => {
    const m = toManifold(weld(unweldedCube(10)));
    expect(fromManifold(m).colors).toBeUndefined();
    const zeros = toManifold({ ...weld(unweldedCube(10)), colors: new Uint8Array(12) });
    expect(fromManifold(zeros).colors).toBeUndefined();
    m.delete();
    zeros.delete();
  });

  it('cut keeps colors on both halves and gives cap triangles slot 0', () => {
    const m = toManifold(paintedCube());
    const [above, below] = m.splitByPlane([0, 0, 1], 5);
    const a = fromManifold(above);
    const b = fromManifold(below);
    expect(only(slotsWhere(a, (n) => n[2] > 0.9), 1)).toBe(true);
    expect(only(slotsWhere(a, (n) => n[2] < -0.9), 0)).toBe(true);
    expect(only(slotsWhere(b, (n) => n[2] < -0.9), 2)).toBe(true);
    expect(only(slotsWhere(b, (n) => n[2] > 0.9), 0)).toBe(true);
    for (const x of [m, above, below]) x.delete();
  });

  it('subtract keeps colors on untouched faces and gives new faces the tool slot when withSlot is applied', () => {
    const m = toManifold(paintedCube());
    const raw = manifold().Manifold.cylinder(20, 2, 2, 32, true).translate([5, 5, 5]);
    const tool = withSlot(raw, 3);
    const cut = m.subtract(tool);
    const out = fromManifold(cut);
    expect(hasPaint(out)).toBe(true);
    expect(only(slotsWhere(out, (n) => n[2] > 0.9), 1)).toBe(true);
    expect(only(slotsWhere(out, (n) => n[2] < -0.9), 2)).toBe(true);
    const wall = slotsWhere(out, (n, c) => Math.abs(n[2]) < 0.01 && Math.hypot(c[0] - 5, c[1] - 5) < 2.01);
    expect(only(wall, 3)).toBe(true);
    const outer = slotsWhere(out, (n, c) => Math.abs(n[2]) < 0.01 && Math.hypot(c[0] - 5, c[1] - 5) > 4);
    expect(only(outer, 0)).toBe(true);
    for (const x of [m, raw, tool, cut]) x.delete();
  });

  it('union with a slot-tagged tool keeps the tool surface in its slot', () => {
    const m = toManifold(paintedCube());
    const raw = manifold().Manifold.cube([4, 4, 4], true).translate([5, 5, 11]);
    const tool = withSlot(raw, 4);
    const joined = m.add(tool);
    const out = fromManifold(joined);
    expect(only(slotsWhere(out, (n, c) => c[2] > 10.5), 4)).toBe(true);
    expect(only(slotsWhere(out, (n, c) => n[2] > 0.9 && c[2] < 10.5), 1)).toBe(true);
    for (const x of [m, raw, tool, joined]) x.delete();
  });

  it('decompose keeps colors per shell', () => {
    const painted = toManifold(paintedCube());
    const plain = manifold().Manifold.cube([10, 10, 10]).translate([30, 0, 0]);
    const both = painted.add(plain);
    const shells = both.decompose();
    expect(shells.length).toBe(2);
    const meshes = shells.map(fromManifold);
    const left = meshes.find((s) => s.positions[0] < 20)!;
    const right = meshes.find((s) => s !== left)!;
    expect(only(slotsWhere(left, (n) => n[2] > 0.9), 1)).toBe(true);
    expect(hasPaint(right)).toBe(false);
    for (const x of [painted, plain, both, ...shells]) x.delete();
  });

  it('transform keeps colors', () => {
    const m = toManifold(paintedCube());
    const ops: Manifold[] = [m.scale([2, 2, 2]), m.rotate([90, 0, 0]), m.mirror([1, 0, 0])];
    const scaled = fromManifold(ops[0]);
    expect(only(slotsWhere(scaled, (n) => n[2] > 0.9), 1)).toBe(true);
    const rotated = fromManifold(ops[1]);
    expect(only(slotsWhere(rotated, (n) => n[1] < -0.9), 1)).toBe(true);
    const mirrored = fromManifold(ops[2]);
    expect(only(slotsWhere(mirrored, (n) => n[2] < -0.9), 2)).toBe(true);
    for (const x of [m, ...ops]) x.delete();
  });

  it('withSlot 0 leaves the surface as Base', () => {
    const raw = manifold().Manifold.cube([10, 10, 10]);
    const tagged = withSlot(raw, 0);
    expect(fromManifold(tagged).colors).toBeUndefined();
    raw.delete();
    tagged.delete();
  });

  it('withPendingPaint with geometry returns it from fromManifold and bakes it', () => {
    const m = toManifold(weld(unweldedCube(10)));
    const refined = fromManifold(m.refineToLength(3));
    expect(refined.indices.length / 3).toBeGreaterThan(12);
    const colors = new Uint8Array(refined.indices.length / 3);
    colors[0] = 1;
    const handle = withPendingPaint(m, colors, { positions: refined.positions, indices: refined.indices });
    expect(fromManifold(handle).indices).toBe(refined.indices);
    expect(fromManifold(handle).positions).toBe(refined.positions);
    expect(fromManifold(handle).colors).toBe(colors);
    const baked = bakePaint(handle);
    expect(baked.status()).toBe('NoError');
    expect(baked.volume()).toBeCloseTo(1000, 2);
    expect(fromManifold(baked).indices.length / 3).toBeGreaterThan(12);
    for (const x of [m, handle, baked]) x.delete();
  });
});
