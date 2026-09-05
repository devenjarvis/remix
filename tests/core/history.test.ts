import { describe, expect, it } from 'vitest';
import { getManifold } from '../../src/core/manifold';
import { bounds } from '../../src/core/trimesh';
import { History } from '../../src/core/history';
import { Engine } from '../../src/core/engine';
import { newId, describeOp } from '../../src/core/ops/types';
import type { Op, ScaleOp } from '../../src/core/ops/types';
import { unweldedCube } from './trimesh.test';

function scale(f: number): ScaleOp {
  return { id: newId(), type: 'scale', factors: [f, f, f] };
}

async function size(engine: Engine, h: History): Promise<number[]> {
  const r = await engine.evaluate(h);
  expect(r.error).toBeUndefined();
  expect(r.manifold).toBe(true);
  expect(r.parts).toHaveLength(1);
  return bounds(r.parts[0]).size.map((v) => Math.round(v * 1000) / 1000);
}

describe('history + engine', () => {
  it('replays, undoes, redoes, truncates, removes, serializes', async () => {
    await getManifold();
    const engine = new Engine();
    engine.setSource(unweldedCube(10));
    expect(engine.sourceManifold).toBe(true);

    const h = new History();
    let changes = 0;
    h.onChange(() => changes++);
    const ops = [scale(2), scale(3), scale(5)];
    for (const op of ops) h.push(op);
    expect(changes).toBe(3);
    expect(await size(engine, h)).toEqual([300, 300, 300]);

    expect(h.undo()).toBe(true);
    expect(h.cursor).toBe(2);
    expect(await size(engine, h)).toEqual([60, 60, 60]);

    expect(h.redo()).toBe(true);
    expect(h.redo()).toBe(false);
    expect(await size(engine, h)).toEqual([300, 300, 300]);

    h.truncateTo(1);
    expect(h.ops).toHaveLength(3);
    expect(h.active).toHaveLength(1);
    expect(await size(engine, h)).toEqual([20, 20, 20]);

    h.truncateTo(3);
    h.remove(ops[0].id);
    expect(h.ops).toHaveLength(2);
    expect(h.cursor).toBe(2);
    expect(await size(engine, h)).toEqual([150, 150, 150]);

    h.undo();
    h.remove(ops[2].id);
    expect(h.cursor).toBe(1);
    expect(h.ops.map((o) => o.id)).toEqual([ops[1].id]);

    const recipe = h.toJSON();
    expect(recipe.version).toBe(1);
    const back = History.fromJSON(JSON.parse(JSON.stringify(recipe)));
    expect(back.ops).toEqual(h.ops);
    expect(back.cursor).toBe(h.cursor);

    h.clear();
    expect(h.ops).toEqual([]);
    expect(h.cursor).toBe(0);
    expect(await size(engine, h)).toEqual([10, 10, 10]);
  });

  it('push truncates the redo tail', () => {
    const h = new History();
    h.push(scale(2));
    h.push(scale(3));
    h.undo();
    const op = scale(4);
    h.push(op);
    expect(h.ops.map((o) => (o as ScaleOp).factors[0])).toEqual([2, 4]);
    expect(h.cursor).toBe(2);
    expect(h.redo()).toBe(false);
  });

  it('sets error on unknown op type', async () => {
    await getManifold();
    const engine = new Engine();
    engine.setSource(unweldedCube(10));
    const h = new History();
    h.push({ id: newId(), type: 'bogus' } as unknown as Op);
    const r = await engine.evaluate(h);
    expect(r.error).toMatch(/bogus/);
  });

  it('refuses ops on a non-manifold source', async () => {
    await getManifold();
    const engine = new Engine();
    const cube = unweldedCube(10);
    engine.setSource({ positions: cube.positions, indices: cube.indices.slice(0, 33) });
    expect(engine.sourceManifold).toBe(false);
    const h = new History();
    let r = await engine.evaluate(h);
    expect(r.manifold).toBe(false);
    expect(r.error).toBeUndefined();
    expect(r.parts[0].indices.length).toBe(33);
    h.push(scale(2));
    r = await engine.evaluate(h);
    expect(r.error).toBeDefined();
  });

  it('describes ops', () => {
    expect(describeOp(scale(2))).toBe('Scale 2×');
    expect(describeOp({ id: 'a', type: 'scale', factors: [1, 2, 3] })).toBe('Scale 1×, 2×, 3×');
    expect(describeOp({ id: 'a', type: 'cut', axis: 'z', offset: 5, keep: 'both' })).toBe('Cut Z at 5 mm');
  });
});
