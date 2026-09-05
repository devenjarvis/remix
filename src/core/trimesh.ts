import type { Manifold } from 'manifold-3d';
import { manifold } from './manifold';
import type { Bounds, TriMesh, Vec3 } from './types';
import { MAX_SLOTS } from './color';

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
  const colors = m.colors ? new Uint8Array(m.colors.length) : null;
  let n = 0;
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = remap[m.indices[t]];
    const b = remap[m.indices[t + 1]];
    const c = remap[m.indices[t + 2]];
    if (a === b || b === c || a === c) continue;
    if (colors) colors[n / 3] = m.colors![t / 3];
    indices[n++] = a;
    indices[n++] = b;
    indices[n++] = c;
  }
  const result: TriMesh = { positions: new Float32Array(out), indices: indices.slice(0, n) };
  if (colors) result.colors = colors.slice(0, n / 3);
  return result;
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

let reserved: { base: number; count: number } | null = null;

/** Reserves one manifold originalID per color slot (Base plus MAX_SLOTS) on first use; needs getManifold() resolved. */
export function slotIds(): { base: number; count: number } {
  if (!reserved) {
    const count = MAX_SLOTS + 1;
    reserved = { base: manifold().Manifold.reserveIDs(count), count };
  }
  return reserved;
}

function slotOfId(id: number): number {
  const { base, count } = slotIds();
  return id >= base && id < base + count ? id - base : 0;
}

export function toManifold(m: TriMesh): Manifold {
  const { Mesh, Manifold } = manifold();
  const w = weld(m);
  const painted = w.colors && w.colors.some((c) => c !== 0);
  if (!painted) {
    const mesh = new Mesh({ numProp: 3, vertProperties: w.positions, triVerts: w.indices });
    mesh.merge();
    return new Manifold(mesh);
  }
  const colors = w.colors!;
  const numTri = colors.length;
  const order = Array.from({ length: numTri }, (_, i) => i).sort((a, b) => colors[a] - colors[b] || a - b);
  const triVerts = new Uint32Array(numTri * 3);
  const runIndex: number[] = [];
  const runOriginalID: number[] = [];
  const { base } = slotIds();
  let last = -1;
  order.forEach((t, i) => {
    triVerts.set(w.indices.subarray(t * 3, t * 3 + 3), i * 3);
    if (colors[t] !== last) {
      last = colors[t];
      runIndex.push(i * 3);
      runOriginalID.push(base + last);
    }
  });
  runIndex.push(numTri * 3);
  const mesh = new Mesh({
    numProp: 3,
    vertProperties: w.positions,
    triVerts,
    runIndex: Uint32Array.from(runIndex),
    runOriginalID: Uint32Array.from(runOriginalID),
  });
  mesh.merge();
  return new Manifold(mesh);
}

/** Rebuilds the manifold with every triangle tagged as `slot`; slot 0 leaves it untagged. */
export function withSlot(m: Manifold, slot: number): Manifold {
  const { Mesh, Manifold } = manifold();
  const mesh = m.getMesh();
  if (slot <= 0) return new Manifold(mesh);
  const tagged = new Mesh({
    numProp: mesh.numProp,
    vertProperties: mesh.vertProperties,
    triVerts: mesh.triVerts,
    runIndex: Uint32Array.from([0, mesh.triVerts.length]),
    runOriginalID: Uint32Array.from([slotIds().base + slot]),
  });
  return new Manifold(tagged);
}

export function fromManifold(m: Manifold): TriMesh {
  const mesh = m.getMesh();
  const positions = new Float32Array(mesh.vertProperties.length / mesh.numProp * 3);
  for (let i = 0; i < positions.length / 3; i++) {
    positions[i * 3] = mesh.vertProperties[i * mesh.numProp];
    positions[i * 3 + 1] = mesh.vertProperties[i * mesh.numProp + 1];
    positions[i * 3 + 2] = mesh.vertProperties[i * mesh.numProp + 2];
  }
  const out: TriMesh = { positions, indices: new Uint32Array(mesh.triVerts) };
  const numTri = mesh.triVerts.length / 3;
  const runs = mesh.runOriginalID;
  if (runs && runs.length && reserved) {
    const colors = new Uint8Array(numTri);
    let painted = false;
    for (let r = 0; r < runs.length; r++) {
      const slot = slotOfId(runs[r]);
      if (!slot) continue;
      const start = mesh.runIndex[r] / 3;
      const end = (r + 1 < mesh.runIndex.length ? mesh.runIndex[r + 1] : mesh.triVerts.length) / 3;
      if (end <= start) continue;
      colors.fill(slot, start, end);
      painted = true;
    }
    if (painted) out.colors = colors;
  }
  return out;
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
  const colors = meshes.some((m) => m.colors) ? new Uint8Array(ni / 3) : null;
  let ov = 0;
  let oi = 0;
  for (const m of meshes) {
    positions.set(m.positions, ov);
    const base = ov / 3;
    for (let i = 0; i < m.indices.length; i++) indices[oi + i] = m.indices[i] + base;
    if (colors && m.colors) colors.set(m.colors, oi / 3);
    ov += m.positions.length;
    oi += m.indices.length;
  }
  const result: TriMesh = { positions, indices };
  if (colors) result.colors = colors;
  return result;
}

export function validateMesh(m: TriMesh): TriMesh {
  if (m.positions.length % 3 !== 0) throw new Error('Vertex data is not a multiple of 3');
  if (m.indices.length % 3 !== 0) throw new Error('Index data is not a multiple of 3');
  if (m.indices.length === 0) throw new Error('Mesh has no triangles');
  for (let i = 0; i < m.positions.length; i++) {
    if (!Number.isFinite(m.positions[i])) throw new Error(`Non-finite coordinate at vertex ${Math.floor(i / 3)}`);
  }
  const nv = m.positions.length / 3;
  for (let i = 0; i < m.indices.length; i++) {
    if (m.indices[i] >= nv) throw new Error(`Triangle index ${m.indices[i]} exceeds vertex count ${nv}`);
  }
  if (m.colors) {
    if (m.colors.length !== m.indices.length / 3) throw new Error('Colors array must have one entry per triangle');
    for (let i = 0; i < m.colors.length; i++) {
      if (m.colors[i] > MAX_SLOTS) throw new Error(`Color slot ${m.colors[i]} at triangle ${i} exceeds ${MAX_SLOTS}`);
    }
  }
  return m;
}

/** Translates the mesh so its XY center is at the origin and its lowest point is at z=0. */
export function placeOnBed(m: TriMesh): TriMesh {
  const b = bounds(m);
  const dx = (b.min[0] + b.max[0]) / 2;
  const dy = (b.min[1] + b.max[1]) / 2;
  const dz = b.min[2];
  if (dx === 0 && dy === 0 && dz === 0) return m;
  const positions = new Float32Array(m.positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = m.positions[i] - dx;
    positions[i + 1] = m.positions[i + 1] - dy;
    positions[i + 2] = m.positions[i + 2] - dz;
  }
  return { ...m, positions };
}
