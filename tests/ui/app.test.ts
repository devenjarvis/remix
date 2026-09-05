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
