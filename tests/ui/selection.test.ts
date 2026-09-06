import { beforeAll, describe, expect, it } from 'vitest';
import { getManifold, manifold } from '../../src/core/manifold';
import { fromManifold } from '../../src/core/trimesh';
import { resolveSelection } from '../../src/core/ops/paint';
import type { Selection } from '../../src/core/ops/types';
import { LiveSelection } from '../../src/ui/selection';

beforeAll(() => getManifold());

describe('LiveSelection', () => {
  it('add, undo, and clear track sets per part', () => {
    const { Manifold } = manifold();
    const parts = [fromManifold(Manifold.cube([10, 10, 10])), fromManifold(Manifold.cube([10, 10, 10]).translate([20, 0, 0]))];
    const live = new LiveSelection();
    expect(live.sets(parts).map((s) => s.some((v) => v))).toEqual([false, false]);
    const part: Selection = { kind: 'part', index: 1 };
    const height: Selection = { kind: 'height', min: 0, max: 5 };
    live.add(part, parts);
    live.add(height, parts);
    expect(live.gestures).toEqual([part, height]);
    const sets = live.sets(parts);
    expect(Array.from(sets[0])).toEqual(Array.from(resolveSelection(parts[0], [height])));
    expect(Array.from(sets[1])).toEqual(Array.from(resolveSelection(parts[1], [part, height])));
    expect(sets[0].some((v) => v)).toBe(true);
    expect(sets[1].every((v) => v)).toBe(true);
    live.add({ kind: 'invert' }, parts);
    expect(Array.from(live.sets(parts)[1])).toEqual(Array.from(resolveSelection(parts[1], [part, height, { kind: 'invert' }])));
    live.undo();
    live.undo();
    expect(live.gestures).toEqual([part]);
    expect(live.sets(parts)[0].some((v) => v)).toBe(false);
    expect(live.sets(parts)[1].every((v) => v)).toBe(true);
    live.clear();
    expect(live.gestures).toEqual([]);
    expect(live.sets(parts).map((s) => s.some((v) => v))).toEqual([false, false]);
  });

  it('recomputes when a part changes and ignores a gesture whose surface is gone', () => {
    const { Manifold } = manifold();
    const parts = [fromManifold(Manifold.cube([10, 10, 10]))];
    const live = new LiveSelection();
    live.add({ kind: 'fill', part: 0, point: [5, 5, 10], normal: [0, 0, 1], angle: 10 }, parts);
    expect(live.sets(parts)[0].some((v) => v)).toBe(true);
    const moved = [fromManifold(Manifold.cube([10, 10, 10]).translate([0, 0, 5]))];
    expect(live.sets(moved)[0].some((v) => v)).toBe(false);
    expect(live.gestures.length).toBe(1);
  });
});
