import { beforeAll, describe, expect, it } from 'vitest';
import type { Manifold } from 'manifold-3d';
import { getManifold, manifold } from '../../src/core/manifold';
import { applyOp } from '../../src/core/ops/registry';
import '../../src/core/ops/cut';
import type { OpContext } from '../../src/core/ops/types';

let ctx: OpContext;
beforeAll(async () => {
  ctx = { manifold: await getManifold() };
});

const cube = (): Manifold => manifold().Manifold.cube([10, 10, 10]);

describe('cut', () => {
  it('cuts a cube at z=4 into 400 and 600 volumes', async () => {
    const parts = await applyOp([cube()], { id: 'a', type: 'cut', axis: 'z', offset: 4, keep: 'both' }, ctx);
    expect(parts.length).toBe(2);
    expect(parts[0].volume()).toBeCloseTo(400, 3);
    expect(parts[1].volume()).toBeCloseTo(600, 3);
    expect(parts[0].boundingBox().max[2]).toBeCloseTo(4);
    expect(parts[1].boundingBox().min[2]).toBeCloseTo(4);
  });

  it('keeps only one side when asked', async () => {
    const below = await applyOp([cube()], { id: 'a', type: 'cut', axis: 'x', offset: 7, keep: 'below' }, ctx);
    expect(below.length).toBe(1);
    expect(below[0].volume()).toBeCloseTo(700, 3);
    const above = await applyOp([cube()], { id: 'a', type: 'cut', axis: 'x', offset: 7, keep: 'above' }, ctx);
    expect(above.length).toBe(1);
    expect(above[0].volume()).toBeCloseTo(300, 3);
  });

  it('drops empty sides when the plane misses the model', async () => {
    const parts = await applyOp([cube()], { id: 'a', type: 'cut', axis: 'y', offset: 50, keep: 'both' }, ctx);
    expect(parts.length).toBe(1);
    expect(parts[0].volume()).toBeCloseTo(1000, 3);
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
