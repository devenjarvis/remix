import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { unweldedCube } from '../core/trimesh.test';
import { bounds, weld } from '../../src/core/trimesh';
import { loadModel } from '../../src/io/load';
import { exportModel, type ExportFormat } from '../../src/io/save';
import type { TriMesh } from '../../src/core/types';

function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

function modelXml(bytes: Uint8Array): string {
  return new TextDecoder().decode(unzipSync(bytes)['3D/3dmodel.model']);
}

function painted(base: TriMesh): TriMesh {
  const colors = new Uint8Array(base.indices.length / 3);
  colors[0] = 1;
  colors[1] = 1;
  colors[4] = 2;
  return { ...base, colors };
}

describe('exportModel', () => {
  const cube = weld(unweldedCube(10));

  for (const format of ['stl', 'obj', '3mf'] as ExportFormat[]) {
    it(`round-trips a cube through ${format}`, async () => {
      const { bytes, droppedColors } = exportModel(cube, format, 'cube');
      expect(bytes.length).toBeGreaterThan(0);
      expect(droppedColors).toBe(false);
      const back = (await loadModel(`cube.${format}`, toArrayBuffer(bytes))).mesh;
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
    const { bytes } = exportModel([cube, shifted], '3mf', 'two');
    const back = (await loadModel('two.3mf', toArrayBuffer(bytes))).mesh;
    expect(back.indices.length / 3).toBe(24);
    expect(bounds(back).max[0]).toBeCloseTo(30);
    expect((modelXml(bytes).match(/<object /g) ?? []).length).toBe(2);
  });

  it('3MF with painted triangles contains m:colorgroup with one m:color per slot, object pid and pindex 0, and p1 plus paint_color on painted triangles only', () => {
    const palette = [
      { name: 'Base', hex: '#b8c4d6' },
      { name: 'Red', hex: '#ff0000' },
      { name: 'Blue', hex: '#0000ff' },
    ];
    const { bytes, droppedColors } = exportModel(painted(cube), '3mf', 'cube', palette);
    expect(droppedColors).toBe(false);
    const xml = modelXml(bytes);
    expect(xml).toContain('xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02"');
    expect(xml).toMatch(/<m:colorgroup id="1">/);
    const colors = [...xml.matchAll(/<m:color color="([^"]*)"\/>/g)].map((m) => m[1]);
    expect(colors).toEqual(['#b8c4d6', '#ff0000', '#0000ff']);
    expect(xml).toMatch(/<object id="2"[^>]*\bpid="1" pindex="0"/);
    expect(xml).toMatch(/<item objectid="2"\/>/);
    const tris = [...xml.matchAll(/<triangle\b[^>]*>/g)].map((m) => m[0]);
    expect(tris.length).toBe(12);
    expect(tris[0]).toMatch(/\bpid="1" p1="1" paint_color="4"/);
    expect(tris[1]).toMatch(/\bpid="1" p1="1" paint_color="4"/);
    expect(tris[4]).toMatch(/\bpid="1" p1="2" paint_color="8"/);
    for (const i of [2, 3, 5, 6, 7, 8, 9, 10, 11]) {
      expect(tris[i]).not.toMatch(/pid|p1|paint_color/);
    }
  });

  it('3MF without paint contains no colorgroup', () => {
    const { bytes } = exportModel({ ...cube, colors: new Uint8Array(12) }, '3mf', 'cube');
    const xml = modelXml(bytes);
    expect(xml).not.toContain('colorgroup');
    expect(xml).not.toContain('xmlns:m');
    expect(xml).toMatch(/<object id="1"/);
    expect(xml).not.toMatch(/pid=/);
    expect(xml).toBe(modelXml(exportModel(cube, '3mf', 'cube').bytes));
  });

  it('export refuses a palette with duplicate hexes', () => {
    const palette = [
      { name: 'Base', hex: '#b8c4d6' },
      { name: 'Red', hex: '#FF0000' },
      { name: 'Red again', hex: '#ff0000' },
    ];
    expect(() => exportModel(painted(cube), '3mf', 'cube', palette)).toThrow(/duplicate colors/);
    expect(() => exportModel(cube, '3mf', 'cube', palette)).not.toThrow();
  });

  it('export refuses a slot outside the palette', () => {
    const palette = [{ name: 'Base', hex: '#b8c4d6' }, { name: 'Red', hex: '#ff0000' }];
    expect(() => exportModel(painted(cube), '3mf', 'cube', palette)).toThrow(/slot 2 but the palette has 2 slots/);
  });

  it('exportModel reports droppedColors for stl and obj of a painted mesh and not for 3mf', () => {
    const m = painted(cube);
    expect(exportModel(m, 'stl', 'cube').droppedColors).toBe(true);
    expect(exportModel(m, 'obj', 'cube').droppedColors).toBe(true);
    expect(exportModel(m, '3mf', 'cube').droppedColors).toBe(false);
    expect(exportModel([cube, m], 'stl', 'cube').droppedColors).toBe(true);
    expect(exportModel(cube, 'stl', 'cube').droppedColors).toBe(false);
  });
});
