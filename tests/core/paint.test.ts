import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { getManifold, manifold } from '../../src/core/manifold';
import { parseFont } from '../../src/core/font';
import { applyOp } from '../../src/core/ops/registry';
import '../../src/core/ops';
import { paintOpFromHit, thinStroke } from '../../src/core/ops/paint';
import { describeOp, type OpContext, type PaintOp } from '../../src/core/ops/types';
import { validateOp } from '../../src/core/ops/validate';
import { fromManifold, toManifold, weld } from '../../src/core/trimesh';
import { triangleCentroid, triangleNormals } from '../../src/core/select';
import type { TriMesh } from '../../src/core/types';
import { IDENTITY, fromAxes } from '../../src/core/mat4';
import { unweldedCube } from './trimesh.test';

let ctx: OpContext;
beforeAll(async () => {
  const buf = readFileSync('public/fonts/Roboto-Regular.ttf');
  const font = parseFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  ctx = { manifold: await getManifold(), font };
});

const cube = () => toManifold(weld(unweldedCube(10)));

function slotsWhere(m: TriMesh, pred: (n: number[], c: number[]) => boolean): number[] {
  const n = triangleNormals(m);
  const out: number[] = [];
  for (let t = 0; t < m.indices.length / 3; t++) {
    const c = triangleCentroid(m, t);
    if (pred([n[t * 3], n[t * 3 + 1], n[t * 3 + 2]], c)) out.push(m.colors?.[t] ?? 0);
  }
  return out;
}
const only = (values: number[], slot: number) => values.length > 0 && values.every((v) => v === slot);

const fill = (color: number, point: [number, number, number], normal: [number, number, number], angle = 30, part = 0): PaintOp => ({
  id: 'p',
  type: 'paint',
  color,
  select: { kind: 'fill', part, point, normal, angle },
});

describe('paint op', () => {
  it('fill paints one cube face and later cut keeps it', async () => {
    const parts = await applyOp([cube()], fill(1, [5, 5, 10], [0, 0, 1]), ctx);
    const m = fromManifold(parts[0]);
    expect(only(slotsWhere(m, (n) => n[2] > 0.9), 1)).toBe(true);
    expect(only(slotsWhere(m, (n) => n[2] < 0.9), 0)).toBe(true);
    const halves = await applyOp(parts, { id: 'c', type: 'cut', axis: 'x', offset: 5, keep: 'both' }, ctx);
    expect(halves.length).toBe(2);
    for (const h of halves.map(fromManifold)) {
      expect(only(slotsWhere(h, (n) => n[2] > 0.9), 1)).toBe(true);
      expect(only(slotsWhere(h, (n) => Math.abs(n[0]) > 0.9), 0)).toBe(true);
    }
  });

  it('fill at a wide angle paints across cube edges', async () => {
    const parts = await applyOp([cube()], fill(2, [5, 5, 10], [0, 0, 1], 100), ctx);
    const m = fromManifold(parts[0]);
    expect(only(slotsWhere(m, (n) => n[2] > -0.9), 2)).toBe(true);
    expect(only(slotsWhere(m, (n) => n[2] < -0.9), 0)).toBe(true);
  });

  it('throws when the fill seed is off the surface', async () => {
    await expect(applyOp([cube()], fill(1, [5, 5, 15], [0, 0, 1]), ctx)).rejects.toThrow(/surface not found/i);
    await expect(applyOp([cube()], fill(1, [5, 5, 10], [0, 0, 1], 30, 3), ctx)).rejects.toThrow(/part/i);
  });

  it('brush paints around a point', async () => {
    const op: PaintOp = {
      id: 'b',
      type: 'paint',
      color: 3,
      select: { kind: 'brush', part: 0, points: [[0, 0, 10]], normals: [[0, 0, 1]], radius: 8 },
    };
    const m = fromManifold((await applyOp([cube()], op, ctx))[0]);
    const painted = slotsWhere(m, (n, c) => Math.hypot(c[0], c[1], c[2] - 10) <= 8);
    expect(only(painted, 3)).toBe(true);
    expect(only(slotsWhere(m, (n, c) => Math.hypot(c[0], c[1], c[2] - 10) > 8), 0)).toBe(true);
  });

  it('height paints the lower half', async () => {
    const op: PaintOp = { id: 'h', type: 'paint', color: 2, select: { kind: 'height', min: 0, max: 5 } };
    const m = fromManifold((await applyOp([cube()], op, ctx))[0]);
    expect(only(slotsWhere(m, (n, c) => c[2] <= 5), 2)).toBe(true);
    expect(only(slotsWhere(m, (n, c) => c[2] > 5), 0)).toBe(true);
  });

  it('part paints only shell 1 after split', async () => {
    const two = cube().add(manifold().Manifold.cube([10, 10, 10]).translate([20, 0, 0]));
    const shells = await applyOp([two], { id: 's', type: 'split', keep: 'all' }, ctx);
    const op: PaintOp = { id: 'p', type: 'paint', color: 4, select: { kind: 'part', index: 1 } };
    const out = await applyOp(shells, op, ctx);
    expect(out[0]).toBe(shells[0]);
    expect(fromManifold(out[0]).colors).toBeUndefined();
    const m = fromManifold(out[1]);
    expect(m.colors!.every((c) => c === 4)).toBe(true);
    expect(fromManifold(out[1]).positions[0]).toBeGreaterThanOrEqual(20);
  });

  it('all paints everything, and Base clears paint', async () => {
    const two = cube().add(manifold().Manifold.cube([10, 10, 10]).translate([20, 0, 0]));
    const shells = await applyOp([two], { id: 's', type: 'split', keep: 'all' }, ctx);
    const out = await applyOp(shells, { id: 'p', type: 'paint', color: 5, select: { kind: 'all' } }, ctx);
    for (const p of out) expect(fromManifold(p).colors!.every((c) => c === 5)).toBe(true);
    const cleared = await applyOp(out, { id: 'q', type: 'paint', color: 0, select: { kind: 'all' } }, ctx);
    for (const p of cleared) expect(fromManifold(p).colors).toBeUndefined();
  });

  it('validateOp rejects color 17 and a fill with zero normal', () => {
    expect(() => validateOp(fill(17, [5, 5, 10], [0, 0, 1]))).toThrow(/color/i);
    expect(() => validateOp(fill(1, [5, 5, 10], [0, 0, 0]))).toThrow(/normal/i);
    expect(() => validateOp({ id: 'x', type: 'paint', color: 1, select: { kind: 'height', min: 5, max: 1 } })).toThrow(/max/i);
    expect(() => validateOp({ id: 'x', type: 'paint', color: 1, select: { kind: 'brush', part: 0, points: [[0, 0, 0]], normals: [], radius: 1 } })).toThrow(/normals/i);
    expect(() => validateOp({ id: 'x', type: 'paint', color: 1.5, select: { kind: 'all' } })).toThrow(/color/i);
    expect(validateOp(fill(16, [5, 5, 10], [0, 0, 1])).type).toBe('paint');
    expect(() => validateOp({ id: 'x', type: 'boolean', mode: 'union', color: 17, tool: { kind: 'box', size: [1, 1, 1] }, matrix: IDENTITY })).toThrow(/color/i);
    const noColor = validateOp({ id: 'x', type: 'boolean', mode: 'union', tool: { kind: 'box', size: [1, 1, 1] }, matrix: IDENTITY });
    expect('color' in noColor).toBe(false);
  });

  it('boolean union with color 2 produces a run of slot 2', async () => {
    const translate = fromAxes([1, 0, 0], [0, 1, 0], [0, 0, 1], [5, 5, 12]);
    const out = await applyOp(
      [cube()],
      { id: 'b', type: 'boolean', mode: 'union', color: 2, tool: { kind: 'box', size: [4, 4, 4] }, matrix: translate },
      ctx,
    );
    const m = fromManifold(out[0]);
    expect(only(slotsWhere(m, (n, c) => c[2] > 10.5), 2)).toBe(true);
    expect(only(slotsWhere(m, (n, c) => c[2] < 9.5), 0)).toBe(true);
    const sub = await applyOp(
      [cube()],
      { id: 'b', type: 'boolean', mode: 'subtract', color: 3, tool: { kind: 'cylinder', size: [4, 4, 30] }, matrix: fromAxes([1, 0, 0], [0, 1, 0], [0, 0, 1], [5, 5, 5]) },
      ctx,
    );
    const s = fromManifold(sub[0]);
    expect(only(slotsWhere(s, (n, c) => Math.abs(n[2]) < 0.01 && Math.hypot(c[0] - 5, c[1] - 5) < 2.01), 3)).toBe(true);
  });

  it('text emboss with color 3 produces slot 3 triangles', async () => {
    const out = await applyOp(
      [cube()],
      { id: 't', type: 'text', text: 'I', height: 6, depth: 1, mode: 'emboss', color: 3, origin: [5, 5, 10], normal: [0, 0, 1], rotation: 0 },
      ctx,
    );
    const m = fromManifold(out[0]);
    expect(only(slotsWhere(m, (n, c) => c[2] > 10.5), 3)).toBe(true);
    expect(only(slotsWhere(m, (n, c) => c[2] < 9.5), 0)).toBe(true);
  });

  it('describeOp names the slot and mode', () => {
    expect(describeOp(fill(2, [0, 0, 0], [0, 0, 1]))).toBe('Paint slot 2 (fill)');
    expect(describeOp({ id: 'x', type: 'paint', color: 0, select: { kind: 'all' } })).toBe('Paint Base (all)');
  });

  it('a fill selection built from a FaceHit validates', () => {
    const op = paintOpFromHit({ point: [1, 2, 3], normal: [0, 0, 1], partIndex: 0 }, 2, 30, 'id1');
    expect(validateOp(op)).toEqual(op);
    expect(op.select.kind).toBe('fill');
  });

  it('thinStroke drops points closer than the spacing to the previous kept point', () => {
    const points: [number, number, number][] = [[0, 0, 0], [0.1, 0, 0], [0.5, 0, 0], [1.2, 0, 0], [1.3, 0, 0]];
    const normals = points.map(() => [0, 0, 1] as [number, number, number]);
    const thinned = thinStroke(points, normals, 1);
    expect(thinned.points).toEqual([[0, 0, 0], [1.2, 0, 0]]);
    expect(thinned.normals.length).toBe(2);
  });
});
