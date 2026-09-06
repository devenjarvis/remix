import { describe, expect, it } from 'vitest';
import type { Manifold } from 'manifold-3d';
import { getManifold } from '../../src/core/manifold';
import { bounds, fromManifold, toManifold } from '../../src/core/trimesh';
import { applyOp, newId } from '../../src/core/ops';
import type { Op } from '../../src/core/ops';
import { scaleFactorsForTarget } from '../../src/core/ops/transform';
import { unweldedCube } from './trimesh.test';

const r3 = (v: number) => Math.round(v * 1000) / 1000;

async function box(): Promise<Manifold> {
  await getManifold();
  return toManifold(unweldedCube(10)).scale([1, 2, 3]);
}

async function run(input: Manifold, op: Op) {
  const ctx = { manifold: await getManifold() };
  const out = await applyOp([input], op, ctx);
  expect(out).toHaveLength(1);
  const b = bounds(fromManifold(out[0]));
  return { min: b.min.map(r3), max: b.max.map(r3), size: b.size.map(r3) };
}

describe('transform ops', () => {
  it('computes uniform factors to reach a target size on one axis', () => {
    expect(scaleFactorsForTarget([10, 20, 30], 'x', 20)).toEqual([2, 2, 2]);
    expect(scaleFactorsForTarget([10, 20, 30], 'z', 15)).toEqual([0.5, 0.5, 0.5]);
  });

  it('scales to size on X', async () => {
    const m = await box();
    const factors = scaleFactorsForTarget(bounds(fromManifold(m)).size, 'x', 20);
    const r = await run(m, { id: newId(), type: 'scale', factors });
    expect(r.size).toEqual([20, 40, 60]);
  });

  it('mirrors across X', async () => {
    await getManifold();
    const r = await run(toManifold(unweldedCube(10)), { id: newId(), type: 'mirror', axis: 'x' });
    expect(r.min).toEqual([-10, 0, 0]);
    expect(r.max).toEqual([0, 10, 10]);
  });
});
