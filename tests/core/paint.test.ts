import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { getManifold, manifold } from '../../src/core/manifold';
import { parseFont } from '../../src/core/font';
import { applyOp } from '../../src/core/ops/registry';
import '../../src/core/ops';
import { consolidatePaints, paintOpFromHit, thinStroke } from '../../src/core/ops/paint';
import { describeOp, type Op, type OpContext, type PaintOp } from '../../src/core/ops/types';
import { validateOp } from '../../src/core/ops/validate';
import { fromManifold, hasPendingPaint, toManifold, weld } from '../../src/core/trimesh';
import { Engine } from '../../src/core/engine';
import { History } from '../../src/core/history';
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

describe('deferred paint', () => {
  it('a paint op shares geometry arrays with its input and bakes only when a geometry op follows', async () => {
    const c = cube();
    const before = fromManifold(c);
    const out = await applyOp([c], fill(1, [5, 5, 10], [0, 0, 1]), ctx);
    expect(hasPendingPaint(out[0])).toBe(true);
    const m = fromManifold(out[0]);
    expect(m.positions).toBe(before.positions);
    expect(m.indices).toBe(before.indices);
    expect(only(slotsWhere(m, (n) => n[2] > 0.9), 1)).toBe(true);
    const again = await applyOp(out, { id: 'q', type: 'paint', color: 2, select: { kind: 'height', min: 0, max: 5 } }, ctx);
    const m2 = fromManifold(again[0]);
    expect(m2.positions).toBe(before.positions);
    expect(only(slotsWhere(m2, (n) => n[2] > 0.9), 1)).toBe(true);
    expect(only(slotsWhere(m2, (n, c) => c[2] < 5 && n[2] > -0.9), 2)).toBe(true);
    expect(fromManifold(out[0]).colors!.every((s) => s !== 2)).toBe(true);
    const scaled = await applyOp(again, { id: 's', type: 'scale', factors: [2, 2, 2] }, ctx);
    expect(hasPendingPaint(scaled[0])).toBe(false);
    const m3 = fromManifold(scaled[0]);
    expect(m3.positions).not.toBe(before.positions);
    expect(only(slotsWhere(m3, (n) => n[2] > 0.9), 1)).toBe(true);
    expect(only(slotsWhere(m3, (n, c) => c[2] < 10 && n[2] > -0.9), 2)).toBe(true);
  });

  it('painting nothing new returns the input by reference', async () => {
    const c = cube();
    const out = await applyOp([c], { id: 'p', type: 'paint', color: 0, select: { kind: 'height', min: 50, max: 60 } }, ctx);
    expect(out[0]).toBe(c);
  });

  it('engine undo after two paints shows the first paint only', async () => {
    const engine = new Engine();
    engine.setSource(weld(unweldedCube(10)));
    const h = new History();
    h.push(fill(1, [5, 5, 10], [0, 0, 1]));
    h.push({ id: 'q', type: 'paint', color: 2, select: { kind: 'all' } });
    let r = await engine.evaluate(h);
    expect(r.parts[0].colors!.every((s) => s === 2)).toBe(true);
    h.undo();
    r = await engine.evaluate(h);
    expect(only(slotsWhere(r.parts[0], (n) => n[2] > 0.9), 1)).toBe(true);
    expect(only(slotsWhere(r.parts[0], (n) => n[2] < 0.9), 0)).toBe(true);
    h.push({ id: 'c', type: 'cut', axis: 'z', offset: 5, keep: 'both' });
    r = await engine.evaluate(h);
    expect(r.error).toBeUndefined();
    expect(r.parts.length).toBe(2);
    expect(only(slotsWhere(r.parts[1], (n) => n[2] > 0.9), 1)).toBe(true);
  });
});

describe('fill rule, refine, and multi selections', () => {
  it('fill with the crease rule paints a cylinder wall in one op and validates the rule', async () => {
    const shape = manifold().Manifold.cube([10, 10, 10]).add(manifold().Manifold.cylinder(20, 3, 3, 64).translate([5, 5, 5]));
    const op: PaintOp = { id: 'f', type: 'paint', color: 2, select: { kind: 'fill', part: 0, point: [8, 5, 15], normal: [1, 0, 0], angle: 30, rule: 'crease' } };
    const m = fromManifold((await applyOp([shape], op, ctx))[0]);
    expect(only(slotsWhere(m, (n, c) => Math.abs(n[2]) < 0.01 && c[2] > 10.01), 2)).toBe(true);
    expect(only(slotsWhere(m, (n, c) => c[2] < 9.9), 0)).toBe(true);
    expect(validateOp(op)).toEqual(op);
    expect(() => validateOp({ ...op, select: { ...op.select, rule: 'magic' } })).toThrow(/rule/i);
    expect('rule' in (validateOp(fill(1, [5, 5, 10], [0, 0, 1])) as PaintOp).select).toBe(false);
  });

  it('refine splits long edges, keeps colors, and validates its length', async () => {
    const painted = await applyOp([cube()], fill(1, [5, 5, 10], [0, 0, 1]), ctx);
    const out = await applyOp(painted, { id: 'r', type: 'refine', length: 2 }, ctx);
    const m = fromManifold(out[0]);
    expect(m.indices.length / 3).toBeGreaterThan(100);
    expect(out[0].volume()).toBeCloseTo(1000, 3);
    expect(only(slotsWhere(m, (n) => n[2] > 0.9), 1)).toBe(true);
    expect(only(slotsWhere(m, (n) => n[2] < 0.9), 0)).toBe(true);
    expect(() => validateOp({ id: 'r', type: 'refine', length: 0 })).toThrow(/length/i);
    expect(describeOp({ id: 'r', type: 'refine', length: 2.5 })).toBe('Refine to 2.5 mm');
  });

  it('a multi selection paints each selection in order across parts', async () => {
    const two = cube().add(manifold().Manifold.cube([10, 10, 10]).translate([20, 0, 0]));
    const shells = await applyOp([two], { id: 's', type: 'split', keep: 'all' }, ctx);
    const op: PaintOp = {
      id: 'm',
      type: 'paint',
      color: 3,
      select: {
        kind: 'multi',
        selections: [
          { kind: 'fill', part: 0, point: [5, 5, 10], normal: [0, 0, 1], angle: 30 },
          { kind: 'fill', part: 1, point: [25, 5, 10], normal: [0, 0, 1], angle: 30 },
          { kind: 'height', min: 0, max: 3 },
        ],
      },
    };
    const out = await applyOp(shells, op, ctx);
    for (const p of out.map(fromManifold)) {
      expect(only(slotsWhere(p, (n) => n[2] > 0.9), 3)).toBe(true);
      expect(only(slotsWhere(p, (n, c) => c[2] < 3), 3)).toBe(true);
      expect(only(slotsWhere(p, (n, c) => Math.abs(n[0]) > 0.9 && c[2] > 3), 0)).toBe(true);
    }
    expect(describeOp(op)).toBe('Paint slot 3 (2 fills, 1 height)');
    expect(() => validateOp({ ...op, select: { kind: 'multi', selections: [] } })).toThrow(/selections/i);
    expect(() => validateOp({ ...op, select: { kind: 'multi', selections: [op.select] } })).toThrow(/nest/i);
  });

  it('consolidatePaints keeps paints with different edges apart', () => {
    const a: PaintOp = { ...fill(1, [5, 5, 10], [0, 0, 1]), edges: 'smooth' };
    const b: PaintOp = { ...fill(1, [5, 0, 5], [0, -1, 0]), id: 'b', edges: 'triangles' };
    const c: PaintOp = { ...fill(1, [0, 5, 5], [-1, 0, 0]), id: 'c', edges: 'triangles' };
    const out = consolidatePaints([a, b, c]);
    expect(out.length).toBe(2);
    expect(out[0]).toBe(a);
    expect(out[1]).toEqual({ ...b, select: { kind: 'multi', selections: [b.select, c.select] } });
  });

  it('consolidatePaints merges consecutive same-color paints and leaves others alone', () => {
    const a = fill(1, [5, 5, 10], [0, 0, 1]);
    const b: PaintOp = { ...fill(1, [5, 0, 5], [0, -1, 0]), id: 'b' };
    const c: PaintOp = { id: 'c', type: 'paint', color: 2, select: { kind: 'all' } };
    const d: PaintOp = { id: 'd', type: 'paint', color: 2, select: { kind: 'multi', selections: [{ kind: 'height', min: 0, max: 1 }] } };
    const scale: Op = { id: 's', type: 'scale', factors: [2, 2, 2] };
    const out = consolidatePaints([a, b, scale, c, d, a]);
    expect(out.length).toBe(4);
    expect(out[0]).toEqual({ id: 'p', type: 'paint', color: 1, select: { kind: 'multi', selections: [a.select, b.select] } });
    expect(out[1]).toBe(scale);
    expect(out[2]).toEqual({ id: 'c', type: 'paint', color: 2, select: { kind: 'multi', selections: [c.select, { kind: 'height', min: 0, max: 1 }] } });
    expect(out[3]).toBe(a);
    for (const op of out) validateOp(op);
  });
});

describe('smooth edges', () => {
  const boss = () => manifold().Manifold.cube([10, 10, 10]).add(manifold().Manifold.cylinder(20, 3, 3, 64).translate([5, 5, 5]));

  it('smooth height paint on a cube ends exactly on the plane', async () => {
    const op: PaintOp = { id: 'h', type: 'paint', color: 2, edges: 'smooth', select: { kind: 'height', min: 0, max: 5 } };
    const out = await applyOp([cube()], op, ctx);
    const m = fromManifold(out[0]);
    expect(m.indices.length / 3).toBe(28);
    expect(only(slotsWhere(m, (n, c) => c[2] < 5), 2)).toBe(true);
    expect(only(slotsWhere(m, (n, c) => c[2] > 5), 0)).toBe(true);
    const zs = new Set<number>();
    for (let i = 2; i < m.positions.length; i += 3) zs.add(m.positions[i]);
    expect([...zs].sort()).toEqual([0, 10, 5]);
    expect(hasPendingPaint(out[0])).toBe(true);
    expect(validateOp(op)).toEqual(op);
  });

  it('smooth height paint on a cylinder wall survives a later cut', async () => {
    const op: PaintOp = { id: 'h', type: 'paint', color: 3, edges: 'smooth', select: { kind: 'height', min: 12.5, max: 30 } };
    const painted = await applyOp([boss()], op, ctx);
    const m = fromManifold(painted[0]);
    const wall = (n: number[], c: number[]) => Math.abs(n[2]) < 0.01 && c[2] > 10.01 && Math.hypot(c[0] - 5, c[1] - 5) > 2.5;
    expect(only(slotsWhere(m, (n, c) => wall(n, c) && c[2] > 12.5), 3)).toBe(true);
    expect(only(slotsWhere(m, (n, c) => wall(n, c) && c[2] < 12.5), 0)).toBe(true);
    expect(m.positions.some((_, i) => i % 3 === 2 && Math.abs(m.positions[i] - 12.5) < 1e-5)).toBe(true);
    const halves = await applyOp(painted, { id: 'c', type: 'cut', axis: 'x', offset: 5, keep: 'both' }, ctx);
    expect(halves.length).toBe(2);
    for (const h of halves) {
      expect(h.status()).toBe('NoError');
      const hm = fromManifold(h);
      expect(only(slotsWhere(hm, (n, c) => wall(n, c) && c[2] > 12.6), 3)).toBe(true);
      expect(only(slotsWhere(hm, (n, c) => wall(n, c) && c[2] < 12.4), 0)).toBe(true);
    }
  });

  it('smooth fill on a cylinder wall ends on the cap crease without splitting', async () => {
    const op: PaintOp = { ...fill(2, [8, 5, 15], [1, 0, 0]), edges: 'smooth' };
    op.select = { ...op.select, rule: 'crease' } as PaintOp['select'];
    const input = boss();
    const before = fromManifold(input);
    const m = fromManifold((await applyOp([input], op, ctx))[0]);
    expect(m.indices).toBe(before.indices);
    expect(only(slotsWhere(m, (n, c) => Math.abs(n[2]) < 0.01 && c[2] > 10.01), 2)).toBe(true);
    expect(only(slotsWhere(m, (n, c) => c[2] < 9.9), 0)).toBe(true);
  });

  it('smooth brush on a refined cube splits the boundary and later paints see the split mesh', async () => {
    const refined = await applyOp([cube()], { id: 'r', type: 'refine', length: 1 }, ctx);
    const before = fromManifold(refined[0]);
    const op: PaintOp = { id: 'b', type: 'paint', color: 3, edges: 'smooth', select: { kind: 'brush', part: 0, points: [[5, 5, 10]], normals: [[0, 0, 1]], radius: 3 } };
    const out = await applyOp(refined, op, ctx);
    const m = fromManifold(out[0]);
    expect(m.indices.length).toBeGreaterThan(before.indices.length);
    expect(only(slotsWhere(m, (n, c) => n[2] > 0.9 && Math.hypot(c[0] - 5, c[1] - 5) < 2), 3)).toBe(true);
    expect(only(slotsWhere(m, (n, c) => n[2] > 0.9 && Math.hypot(c[0] - 5, c[1] - 5) > 4), 0)).toBe(true);
    for (let i = 2; i < m.positions.length; i += 3) expect(m.positions[i]).toBeGreaterThanOrEqual(0);
    const again = await applyOp(out, { id: 'q', type: 'paint', color: 1, edges: 'smooth', select: { kind: 'height', min: 0, max: 5 } }, ctx);
    const m2 = fromManifold(again[0]);
    expect(m2.indices.length).toBeGreaterThan(m.indices.length);
    expect(only(slotsWhere(m2, (n, c) => n[2] > 0.9 && Math.hypot(c[0] - 5, c[1] - 5) < 2), 3)).toBe(true);
    expect(only(slotsWhere(m2, (n, c) => c[2] < 5), 1)).toBe(true);
    const scaled = await applyOp(again, { id: 's', type: 'scale', factors: [2, 2, 2] }, ctx);
    expect(scaled[0].status()).toBe('NoError');
    expect(scaled[0].volume()).toBeCloseTo(8000, 2);
  });

  it('smooth paint on a crease boundary keeps geometry identity', async () => {
    const c = cube();
    const before = fromManifold(c);
    const out = await applyOp([c], { ...fill(1, [5, 5, 10], [0, 0, 1]), edges: 'smooth' }, ctx);
    const m = fromManifold(out[0]);
    expect(m.indices).toBe(before.indices);
    expect(m.positions).toBe(before.positions);
    expect(only(slotsWhere(m, (n) => n[2] > 0.9), 1)).toBe(true);
  });

  it('validateOp rejects edges fuzzy and omits the field when absent', () => {
    expect(() => validateOp({ ...fill(1, [5, 5, 10], [0, 0, 1]), edges: 'fuzzy' })).toThrow(/edges/i);
    expect('edges' in validateOp(fill(1, [5, 5, 10], [0, 0, 1]))).toBe(false);
    expect((validateOp({ ...fill(1, [5, 5, 10], [0, 0, 1]), edges: 'triangles' }) as PaintOp).edges).toBe('triangles');
    const op = paintOpFromHit({ point: [1, 2, 3], normal: [0, 0, 1], partIndex: 0 }, 2, 30, 'id1');
    expect(op.edges).toBe('smooth');
    expect(paintOpFromHit({ point: [1, 2, 3], normal: [0, 0, 1], partIndex: 0 }, 2, 30, 'id1', 'seed', 'triangles').edges).toBe('triangles');
  });
});
