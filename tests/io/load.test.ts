import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { loadModel } from '../../src/io/load';
import { exportModel } from '../../src/io/save';
import { bounds, triangleCount, weld } from '../../src/core/trimesh';
import { unweldedCube } from '../core/trimesh.test';

function fixture(name: string): ArrayBuffer {
  const buf = readFileSync(join(__dirname, '..', 'fixtures', name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

function package3mf(model: string): ArrayBuffer {
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;
  return toArrayBuffer(zipSync({ '_rels/.rels': strToU8(rels), '3D/3dmodel.model': strToU8(model) }));
}

function fanModel(triangles: string[], resources: string): string {
  const vs = ['<vertex x="0" y="0" z="0"/>'];
  for (let i = 0; i < triangles.length; i++) {
    vs.push(`<vertex x="${i + 1}" y="0" z="0"/>`, `<vertex x="${i + 1}" y="1" z="0"/>`);
  }
  const ts = triangles.map((extra, i) => `<triangle v1="0" v2="${2 * i + 1}" v3="${2 * i + 2}"${extra}/>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">
<resources>${resources}<object id="9" type="model"><mesh><vertices>${vs.join('')}</vertices><triangles>${ts.join('')}</triangles></mesh></object></resources>
<build><item objectid="9"/></build>
</model>`;
}

async function expectCube(name: string, size: number) {
  const loaded = await loadModel(name, fixture(name));
  const m = loaded.mesh;
  expect(loaded.warnings).toEqual([]);
  expect(triangleCount(m)).toBe(12);
  expect(m.positions.length / 3).toBe(8);
  const b = bounds(m);
  expect(b.min).toEqual([0, 0, 0]);
  expect(b.max[0]).toBeCloseTo(size, 3);
  expect(b.max[1]).toBeCloseTo(size, 3);
  expect(b.max[2]).toBeCloseTo(size, 3);
}

describe('loadModel', () => {
  it('loads binary STL', () => expectCube('cube.stl', 10));
  it('loads ASCII STL', () => expectCube('cube-ascii.stl', 10));
  it('loads OBJ', () => expectCube('cube.obj', 10));
  it('loads 3MF', () => expectCube('cube.3mf', 10));
  it('scales 3MF inch units to mm', () => expectCube('cube-inch.3mf', 254));

  it('returns no palette for an unpainted 3MF', async () => {
    const loaded = await loadModel('cube.3mf', fixture('cube.3mf'));
    expect(loaded.palette).toBeUndefined();
  });

  it('dispatches case-insensitively', async () => {
    const { mesh } = await loadModel('CUBE.STL', fixture('cube.stl'));
    expect(triangleCount(mesh)).toBe(12);
  });

  it('throws on unknown extension', async () => {
    await expect(loadModel('cube.step', new ArrayBuffer(0))).rejects.toThrow(/unsupported/i);
  });
});

describe('loadModel colors', () => {
  it('loads a colored 3MF fixture with colorgroup references into two slots', async () => {
    const loaded = await loadModel('cube-colors.3mf', fixture('cube-colors.3mf'));
    expect(loaded.warnings).toEqual([]);
    expect([...loaded.mesh.colors!]).toEqual([1, 1, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(loaded.palette!.map((p) => p.hex)).toEqual(['#b8c4d6', '#0000FF', '#FF0000']);
    expect(loaded.palette![0].name).toBe('Base');
  });

  it('loads a fixture with basematerials displaycolor', async () => {
    const loaded = await loadModel('cube-basematerials.3mf', fixture('cube-basematerials.3mf'));
    expect(loaded.warnings).toEqual([]);
    expect([...loaded.mesh.colors!]).toEqual([1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(loaded.palette!.map((p) => p.hex)).toEqual(['#b8c4d6', '#0000FF']);
  });

  it('loads paint_color attributes', async () => {
    const loaded = await loadModel('cube-paint.3mf', fixture('cube-paint.3mf'));
    expect(loaded.warnings).toEqual([]);
    expect([...loaded.mesh.colors!]).toEqual([1, 1, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(loaded.palette!.length).toBe(3);
    expect(loaded.palette!.map((p) => p.hex)).toEqual(['#b8c4d6', '#e04b3a', '#3a8fe0']);
  });

  it('a 17th distinct color maps to Base with a warning', async () => {
    const n = 17;
    const colors = Array.from({ length: n }, (_, i) => `<m:color color="#${i.toString(16).padStart(2, '0')}0000"/>`);
    const resources = `<m:colorgroup id="1">${colors.join('')}</m:colorgroup>`;
    const tris = Array.from({ length: n }, (_, i) => ` pid="1" p1="${i}"`);
    const loaded = await loadModel('many.3mf', package3mf(fanModel(tris, resources)));
    expect(loaded.warnings).toEqual(['Model uses more than 16 colors; extra colors were treated as Base']);
    expect([...loaded.mesh.colors!]).toEqual([...Array.from({ length: 16 }, (_, i) => i + 1), 0]);
    expect(loaded.palette!.length).toBe(17);
  });

  it('split paint codes fall back to the referenced color with a warning', async () => {
    const resources = `<m:colorgroup id="1"><m:color color="#00ff00"/></m:colorgroup>`;
    const tris = [' paint_color="5" pid="1" p1="0"', ' paint_color="1"', ' paint_color="8"', ''];
    const loaded = await loadModel('split.3mf', package3mf(fanModel(tris, resources)));
    expect(loaded.warnings).toEqual(['2 triangle(s) with split paint were treated as Base']);
    expect([...loaded.mesh.colors!]).toEqual([1, 0, 2, 0]);
    expect(loaded.palette!.map((p) => p.hex)).toEqual(['#b8c4d6', '#00FF00', '#3a8fe0']);
  });

  it('exported painted 3MF round-trips colors and palette', async () => {
    const cube = weld(unweldedCube(10));
    const colors = new Uint8Array(12);
    colors[0] = 3;
    colors[5] = 1;
    colors[7] = 3;
    const palette = [
      { name: 'Base', hex: '#b8c4d6' },
      { name: 'Red', hex: '#ff0000' },
      { name: 'Green', hex: '#00ff00' },
      { name: 'Blue', hex: '#0000ff' },
    ];
    const { bytes } = exportModel({ ...cube, colors }, '3mf', 'cube', palette);
    const loaded = await loadModel('cube.3mf', toArrayBuffer(bytes));
    expect(loaded.warnings).toEqual([]);
    expect([...loaded.mesh.colors!]).toEqual([...colors]);
    expect(loaded.palette!.map((p) => p.hex.toLowerCase())).toEqual(palette.map((p) => p.hex));
  });
});

describe('loadModel validation', () => {
  it('rejects out-of-range indices and non-finite coordinates', async () => {
    const bad = new TextEncoder().encode('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 9\n');
    await expect(loadModel('bad.obj', bad.buffer as ArrayBuffer)).rejects.toThrow(/exceeds vertex count|Non-finite/);
    const nan = new TextEncoder().encode('v 0 0 0\nv 1 0 0\nv 0 nan 0\nf 1 2 3\n');
    await expect(loadModel('nan.obj', nan.buffer as ArrayBuffer)).rejects.toThrow(/Non-finite/);
  });
});
