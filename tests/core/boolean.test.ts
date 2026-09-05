import { beforeAll, describe, expect, it } from 'vitest';
import { getManifold, manifold } from '../../src/core/manifold';
import { applyOp } from '../../src/core/ops/registry';
import '../../src/core/ops/boolean';
import type { OpContext } from '../../src/core/ops/types';
import { IDENTITY, fromAxes } from '../../src/core/mat4';
import { unweldedCube } from './trimesh.test';

let ctx: OpContext;
beforeAll(async () => {
  ctx = { manifold: await getManifold() };
});

const translate = (x: number, y: number, z: number) => fromAxes([1, 0, 0], [0, 1, 0], [0, 0, 1], [x, y, z]);

describe('boolean', () => {
  it('subtracts a 4 mm cylinder through a 10 mm cube', async () => {
    const cube = manifold().Manifold.cube([10, 10, 10]);
    const parts = await applyOp(
      [cube],
      { id: 'b', type: 'boolean', mode: 'subtract', tool: { kind: 'cylinder', size: [4, 4, 20] }, matrix: translate(5, 5, 5) },
      ctx,
    );
    expect(parts.length).toBe(1);
    const expected = 1000 - Math.PI * 4 * 10;
    expect(Math.abs(parts[0].volume() - expected) / expected).toBeLessThan(0.01);
    expect(parts[0].status()).toBe('NoError');
  });

  it('unions two disjoint cubes into volume 2000', async () => {
    const cube = manifold().Manifold.cube([10, 10, 10]);
    const parts = await applyOp(
      [cube],
      { id: 'b', type: 'boolean', mode: 'union', tool: { kind: 'box', size: [10, 10, 10] }, matrix: translate(25, 5, 5) },
      ctx,
    );
    expect(parts.length).toBe(1);
    expect(parts[0].volume()).toBeCloseTo(2000, 3);
  });

  it('intersects with a sphere and with an imported mesh tool', async () => {
    const cube = manifold().Manifold.cube([10, 10, 10]);
    const sphere = await applyOp(
      [cube],
      { id: 'b', type: 'boolean', mode: 'intersect', tool: { kind: 'sphere', size: [10, 10, 10] }, matrix: translate(5, 5, 5) },
      ctx,
    );
    const v = sphere[0].volume();
    expect(v).toBeGreaterThan(500);
    expect(v).toBeLessThan((4 / 3) * Math.PI * 125);

    const raw = unweldedCube(10);
    const meshTool = { kind: 'mesh' as const, name: 'cube.stl', positions: Array.from(raw.positions), indices: Array.from(raw.indices) };
    const parts = await applyOp(
      [manifold().Manifold.cube([10, 10, 10])],
      { id: 'b', type: 'boolean', mode: 'intersect', tool: meshTool, matrix: translate(5, 0, 0) },
      ctx,
    );
    expect(parts[0].volume()).toBeCloseTo(500, 3);
  });

  it('drops parts that vanish', async () => {
    const cube = manifold().Manifold.cube([10, 10, 10]);
    const parts = await applyOp(
      [cube],
      { id: 'b', type: 'boolean', mode: 'intersect', tool: { kind: 'box', size: [1, 1, 1] }, matrix: translate(50, 50, 50) },
      ctx,
    );
    expect(parts.length).toBe(0);
    expect(IDENTITY.length).toBe(16);
  });
});

describe('boolean with no parts', () => {
  it('returns a live tool for union and nothing for subtract', async () => {
    const parts = await applyOp([], { id: 'b', type: 'boolean', mode: 'union', tool: { kind: 'box', size: [10, 10, 10] }, matrix: IDENTITY }, ctx);
    expect(parts.length).toBe(1);
    expect(parts[0].volume()).toBeCloseTo(1000, 3);
    const none = await applyOp([], { id: 'b', type: 'boolean', mode: 'subtract', tool: { kind: 'box', size: [10, 10, 10] }, matrix: IDENTITY }, ctx);
    expect(none.length).toBe(0);
  });
});
