import { beforeAll, describe, expect, it } from 'vitest';
import type { Manifold } from 'manifold-3d';
import { getManifold, manifold } from '../../src/core/manifold';
import { applyOp } from '../../src/core/ops/registry';
import { offsetRange } from '../../src/core/ops/cut';
import type { OpContext } from '../../src/core/ops/types';
import type { Vec3 } from '../../src/core/types';

let ctx: OpContext;
beforeAll(async () => {
  ctx = { manifold: await getManifold() };
});

const cube = (): Manifold => manifold().Manifold.cube([10, 10, 10]);

describe('cut', () => {
  it('cuts a cube at z=4 into 400 and 600 volumes', async () => {
    const parts = await applyOp([cube()], { id: 'a', type: 'cut', normal: [0, 0, 1], offset: 4, keep: 'both' }, ctx);
    expect(parts.length).toBe(2);
    expect(parts[0].volume()).toBeCloseTo(400, 3);
    expect(parts[1].volume()).toBeCloseTo(600, 3);
    expect(parts[0].boundingBox().max[2]).toBeCloseTo(4);
    expect(parts[1].boundingBox().min[2]).toBeCloseTo(4);
  });

  it('keeps only one side when asked', async () => {
    const below = await applyOp([cube()], { id: 'a', type: 'cut', normal: [1, 0, 0], offset: 7, keep: 'below' }, ctx);
    expect(below.length).toBe(1);
    expect(below[0].volume()).toBeCloseTo(700, 3);
    const above = await applyOp([cube()], { id: 'a', type: 'cut', normal: [1, 0, 0], offset: 7, keep: 'above' }, ctx);
    expect(above.length).toBe(1);
    expect(above[0].volume()).toBeCloseTo(300, 3);
  });

  it('drops empty sides when the plane misses the model', async () => {
    const parts = await applyOp([cube()], { id: 'a', type: 'cut', normal: [0, 1, 0], offset: 50, keep: 'both' }, ctx);
    expect(parts.length).toBe(1);
    expect(parts[0].volume()).toBeCloseTo(1000, 3);
  });

  it('cuts on a slanted plane through the center', async () => {
    const normal: Vec3 = [1, 1, 0];
    const parts = await applyOp([cube()], { id: 'a', type: 'cut', normal, offset: 10 / Math.hypot(1, 1), keep: 'both' }, ctx);
    expect(parts.length).toBe(2);
    expect(parts[0].volume()).toBeCloseTo(500, 3);
    expect(parts[1].volume()).toBeCloseTo(500, 3);
  });

  it('keeps the half the normal points toward', async () => {
    const normal: Vec3 = [1, 1, 0];
    const offset = 15 / Math.hypot(1, 1);
    const above = await applyOp([cube()], { id: 'a', type: 'cut', normal, offset, keep: 'above' }, ctx);
    expect(above.length).toBe(1);
    expect(above[0].volume()).toBeCloseTo(125, 3);
    expect(above[0].boundingBox().min[0]).toBeCloseTo(5);
    expect(above[0].boundingBox().min[1]).toBeCloseTo(5);

    const below = await applyOp([cube()], { id: 'a', type: 'cut', normal, offset, keep: 'below' }, ctx);
    expect(below.length).toBe(1);
    expect(below[0].volume()).toBeCloseTo(875, 3);
  });

  it('measures offset in mm whatever the length of the normal', async () => {
    const unit = await applyOp([cube()], { id: 'a', type: 'cut', normal: [0, 0, 1], offset: 4, keep: 'below' }, ctx);
    const long = await applyOp([cube()], { id: 'a', type: 'cut', normal: [0, 0, 2], offset: 4, keep: 'below' }, ctx);
    expect(long[0].boundingBox().max[2]).toBeCloseTo(unit[0].boundingBox().max[2]);
    expect(long[0].volume()).toBeCloseTo(unit[0].volume(), 3);
  });

  it('projects a bounding box onto a normal', () => {
    const box = { min: [0, 0, 0] as Vec3, max: [10, 10, 10] as Vec3, size: [10, 10, 10] as Vec3 };
    expect(offsetRange(box, [0, 0, 1])).toEqual([0, 10]);
    const [lo, hi] = offsetRange(box, [1, 1, 0]);
    expect(lo).toBeCloseTo(0);
    expect(hi).toBeCloseTo(20 / Math.hypot(1, 1));
  });
});

describe('split', () => {
  it('separates two disconnected cubes', async () => {
    const two = cube().add(cube().translate([20, 0, 0]));
    const parts = await applyOp([two], { id: 's', type: 'split', keep: 'all' }, ctx);
    expect(parts.length).toBe(2);
    expect(parts[0].volume() + parts[1].volume()).toBeCloseTo(2000, 3);
  });

  it('keeps only the selected shells', async () => {
    const two = cube().add(cube().translate([20, 0, 0]));
    const parts = await applyOp([two], { id: 's', type: 'split', keep: [1] }, ctx);
    expect(parts.length).toBe(1);
    expect(parts[0].boundingBox().min[0]).toBeCloseTo(20);
  });

  it('orders shells by min x, y, z so keep indices are stable', async () => {
    const two = cube().translate([20, 0, 0]).add(cube());
    const parts = await applyOp([two], { id: 's', type: 'split', keep: 'all' }, ctx);
    expect(parts[0].boundingBox().min[0]).toBeCloseTo(0);
  });
});
