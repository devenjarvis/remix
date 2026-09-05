import { describe, expect, it } from 'vitest';
import type { Manifold } from 'manifold-3d';
import { getManifold, manifold } from '../../src/core/manifold';
import { applyOp, newId } from '../../src/core/ops';
import type { LayFlatOp, OpContext } from '../../src/core/ops';
import type { Vec3 } from '../../src/core/types';

async function layFlat(normal: Vec3): Promise<{ min: Vec3; size: Vec3 }> {
  const ctx: OpContext = { manifold: await getManifold() };
  const box = manifold().Manifold.cube([10, 20, 30]).translate([5, -7, 3]);
  const op: LayFlatOp = { id: newId(), type: 'layflat', normal };
  const [out] = await applyOp([box], op, ctx);
  const b = out.boundingBox();
  const size: Vec3 = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
  for (const m of [box, out] as Manifold[]) m.delete();
  return { min: b.min, size };
}

describe('layflat', () => {
  it('lays the +X face on the bed', async () => {
    const r = await layFlat([1, 0, 0]);
    expect(r.min[2]).toBeCloseTo(0, 4);
    expect(r.size[2]).toBeCloseTo(10, 4);
    expect(r.size[0]).toBeCloseTo(30, 4);
    expect(r.size[1]).toBeCloseTo(20, 4);
  });

  it('flips the +Z face onto the bed', async () => {
    const r = await layFlat([0, 0, 1]);
    expect(r.min[2]).toBeCloseTo(0, 4);
    expect(r.size).toEqual([10, 20, 30].map((v) => expect.closeTo(v, 4)));
  });

  it('only drops to the bed when the face already faces down', async () => {
    const r = await layFlat([0, 0, -1]);
    expect(r.min[0]).toBeCloseTo(5, 4);
    expect(r.min[1]).toBeCloseTo(-7, 4);
    expect(r.min[2]).toBeCloseTo(0, 4);
    expect(r.size).toEqual([10, 20, 30].map((v) => expect.closeTo(v, 4)));
  });

  it('applies the same transform to every part', async () => {
    const ctx: OpContext = { manifold: await getManifold() };
    const { Manifold } = manifold();
    const a = Manifold.cube([10, 10, 10]);
    const b = Manifold.cube([10, 10, 10]).translate([0, 0, 20]);
    const op: LayFlatOp = { id: newId(), type: 'layflat', normal: [0, 1, 0] };
    const out = await applyOp([a, b], op, ctx);
    const minZ = Math.min(...out.map((m) => m.boundingBox().min[2]));
    expect(minZ).toBeCloseTo(0, 4);
    expect(out[1].boundingBox().min[2]).toBeCloseTo(0, 4);
    for (const m of [a, b, ...out]) m.delete();
  });
});
