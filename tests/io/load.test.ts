import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadModel } from '../../src/io/load';
import { bounds, triangleCount } from '../../src/core/trimesh';

function fixture(name: string): ArrayBuffer {
  const buf = readFileSync(join(__dirname, '..', 'fixtures', name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

async function expectCube(name: string, size: number) {
  const m = await loadModel(name, fixture(name));
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

  it('dispatches case-insensitively', async () => {
    const m = await loadModel('CUBE.STL', fixture('cube.stl'));
    expect(triangleCount(m)).toBe(12);
  });

  it('throws on unknown extension', async () => {
    await expect(loadModel('cube.step', new ArrayBuffer(0))).rejects.toThrow(/unsupported/i);
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
