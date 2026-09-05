import type { Manifold } from 'manifold-3d';
import { manifold } from './manifold';
import type { Bounds, TriMesh, Vec3 } from './types';

export function weld(m: TriMesh, tol = 1e-5): TriMesh {
  const inv = 1 / tol;
  const keyToIndex = new Map<string, number>();
  const remap = new Uint32Array(m.positions.length / 3);
  const out: number[] = [];
  for (let i = 0; i < m.positions.length / 3; i++) {
    const x = m.positions[i * 3];
    const y = m.positions[i * 3 + 1];
    const z = m.positions[i * 3 + 2];
    const key = `${Math.round(x * inv)},${Math.round(y * inv)},${Math.round(z * inv)}`;
    let idx = keyToIndex.get(key);
    if (idx === undefined) {
      idx = out.length / 3;
      keyToIndex.set(key, idx);
      out.push(x, y, z);
    }
    remap[i] = idx;
  }
  const indices = new Uint32Array(m.indices.length);
  let n = 0;
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = remap[m.indices[t]];
    const b = remap[m.indices[t + 1]];
    const c = remap[m.indices[t + 2]];
    if (a === b || b === c || a === c) continue;
    indices[n++] = a;
    indices[n++] = b;
    indices[n++] = c;
  }
  return { positions: new Float32Array(out), indices: indices.slice(0, n) };
}

export function bounds(m: TriMesh): Bounds {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const p = m.positions;
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = p[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  if (p.length === 0) return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] };
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

export function toManifold(m: TriMesh): Manifold {
  const { Mesh, Manifold } = manifold();
  const w = weld(m);
  const mesh = new Mesh({ numProp: 3, vertProperties: w.positions, triVerts: w.indices });
  mesh.merge();
  return new Manifold(mesh);
}

export function fromManifold(m: Manifold): TriMesh {
  const mesh = m.getMesh();
  const positions = new Float32Array(mesh.vertProperties.length / mesh.numProp * 3);
  for (let i = 0; i < positions.length / 3; i++) {
    positions[i * 3] = mesh.vertProperties[i * mesh.numProp];
    positions[i * 3 + 1] = mesh.vertProperties[i * mesh.numProp + 1];
    positions[i * 3 + 2] = mesh.vertProperties[i * mesh.numProp + 2];
  }
  return { positions, indices: new Uint32Array(mesh.triVerts) };
}

export function isManifold(m: TriMesh): { ok: boolean; status: string } {
  let mf: Manifold | null = null;
  try {
    mf = toManifold(m);
    const status = mf.status();
    return { ok: status === 'NoError' && !mf.isEmpty(), status };
  } catch (e) {
    return { ok: false, status: e instanceof Error ? e.message : String(e) };
  } finally {
    mf?.delete();
  }
}

export function triangleCount(m: TriMesh): number {
  return m.indices.length / 3;
}

export function mergeMeshes(meshes: TriMesh[]): TriMesh {
  let nv = 0;
  let ni = 0;
  for (const m of meshes) {
    nv += m.positions.length;
    ni += m.indices.length;
  }
  const positions = new Float32Array(nv);
  const indices = new Uint32Array(ni);
  let ov = 0;
  let oi = 0;
  for (const m of meshes) {
    positions.set(m.positions, ov);
    const base = ov / 3;
    for (let i = 0; i < m.indices.length; i++) indices[oi + i] = m.indices[i] + base;
    ov += m.positions.length;
    oi += m.indices.length;
  }
  return { positions, indices };
}
