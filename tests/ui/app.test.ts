import { beforeAll, describe, expect, it } from 'vitest';
import { Engine } from '../../src/core/engine';
import { History } from '../../src/core/history';
import { getManifold } from '../../src/core/manifold';
import { AppState } from '../../src/ui/app';
import { unweldedCube } from '../core/trimesh.test';

beforeAll(() => getManifold());

describe('AppState refresh', () => {
  it('serializes overlapping evaluations and ends on the latest history', async () => {
    const app = new AppState(new History(), new Engine());
    app.setSource(unweldedCube(10), 'cube.stl');
    const runs: Promise<void>[] = [];
    for (let i = 0; i < 5; i++) {
      app.history.push({ id: String(i), type: 'cut', axis: 'z', offset: 5 - i * 0.5, keep: 'both' });
      runs.push(app.refresh());
    }
    app.history.pushAll([
      { id: 'u', type: 'boolean', mode: 'union', tool: { kind: 'box', size: [2, 2, 2] }, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1] },
      { id: 'sc', type: 'scale', factors: [2, 2, 2] },
    ]);
    await Promise.all(runs);
    await app.refresh();
    expect(app.busy).toBe(false);
    expect(app.result?.error).toBeUndefined();
    expect(app.history.ops.length).toBe(7);
    expect(app.bounds?.size[2]).toBeCloseTo(20, 3);
  });
});

describe('AppState preview', () => {
  it('evaluates a preview op without committing it, then applies it from cache', async () => {
    const app = new AppState(new History(), new Engine());
    app.setSource(unweldedCube(10), 'cube.stl');
    await app.refresh();
    app.setPreview({ id: 'p', type: 'scale', factors: [2, 2, 2] }, 0);
    await new Promise((r) => setTimeout(r, 5));
    await app.refresh();
    expect(app.preview?.id).toBe('p');
    expect(app.bounds?.size).toEqual([20, 20, 20]);
    expect(app.history.ops.length).toBe(0);

    app.setPreview(null);
    await app.refresh();
    expect(app.preview).toBeNull();
    expect(app.bounds?.size).toEqual([10, 10, 10]);

    app.setPreview({ id: 'q', type: 'rotate', axis: 'z', degrees: NaN }, 0);
    await new Promise((r) => setTimeout(r, 5));
    expect(app.preview).toBeNull();

    app.setPreview({ id: 'p', type: 'scale', factors: [2, 2, 2] }, 0);
    await new Promise((r) => setTimeout(r, 5));
    await app.refresh();
    app.pushOp({ id: 'p', type: 'scale', factors: [2, 2, 2] });
    await app.refresh();
    expect(app.preview).toBeNull();
    expect(app.history.ops.length).toBe(1);
    expect(app.bounds?.size).toEqual([20, 20, 20]);
  });
});

describe('AppState palette', () => {
  it('setPalette emits change and leaves history length unchanged', async () => {
    const app = new AppState(new History(), new Engine());
    app.setSource(unweldedCube(10), 'cube.stl');
    app.history.push({ id: 'p', type: 'paint', color: 1, select: { kind: 'all' } });
    let changes = 0;
    app.onChange(() => changes++);
    const hexes: string[][] = [];
    app.viewport = {
      setParts() {},
      showPlane() {},
      hidePlane() {},
      onFacePick: () => () => {},
      setPickMode() {},
      fitCamera() {},
      setPalette: (h) => hexes.push(h),
    };
    app.setPalette([{ name: 'Base', hex: '#111111' }, { name: 'One', hex: '#ff0000' }]);
    expect(changes).toBe(1);
    expect(app.history.ops.length).toBe(1);
    expect(app.palette[1].hex).toBe('#ff0000');
    expect(hexes).toEqual([['#111111', '#ff0000']]);
    app.setSource(unweldedCube(10), 'cube.stl');
    expect(app.palette.length).toBe(5);
    app.setSource(unweldedCube(10), 'cube.3mf', [{ name: 'Base', hex: '#000000' }]);
    expect(app.palette).toEqual([{ name: 'Base', hex: '#000000' }]);
  });
});
