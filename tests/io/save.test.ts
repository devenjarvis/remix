import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { unweldedCube } from '../core/trimesh.test';
import { bounds, weld } from '../../src/core/trimesh';
import { loadModel } from '../../src/io/load';
import { exportModel, type ExportFormat } from '../../src/io/save';

function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

describe('exportModel', () => {
  const cube = weld(unweldedCube(10));

  for (const format of ['stl', 'obj', '3mf'] as ExportFormat[]) {
    it(`round-trips a cube through ${format}`, async () => {
      const bytes = exportModel(cube, format, 'cube');
      expect(bytes.length).toBeGreaterThan(0);
      const back = await loadModel(`cube.${format}`, toArrayBuffer(bytes));
      expect(back.indices.length).toBe(cube.indices.length);
      const a = bounds(cube);
      const b = bounds(back);
      for (let k = 0; k < 3; k++) {
        expect(Math.abs(a.min[k] - b.min[k])).toBeLessThan(0.001);
        expect(Math.abs(a.max[k] - b.max[k])).toBeLessThan(0.001);
      }
    });
  }

  it('writes multiple parts as separate 3MF objects', async () => {
    const shifted = { positions: cube.positions.map((v, i) => (i % 3 === 0 ? v + 20 : v)), indices: cube.indices };
    const bytes = exportModel([cube, shifted], '3mf', 'two');
    const back = await loadModel('two.3mf', toArrayBuffer(bytes));
    expect(back.indices.length / 3).toBe(24);
    expect(bounds(back).max[0]).toBeCloseTo(30);
    const text = new TextDecoder().decode(unzipSync(bytes)['3D/3dmodel.model']);
    expect((text.match(/<object /g) ?? []).length).toBe(2);
  });
});
