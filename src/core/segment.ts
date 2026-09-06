import type { TriMesh } from './types';
import { adjacencyOf, triangleNormals } from './select';

const RAD_TO_DEG = 180 / Math.PI;

const segmentCache = new WeakMap<Uint32Array, Map<number, Uint32Array>>();

function triangleAreas(m: TriMesh): Float32Array {
  const p = m.positions, idx = m.indices;
  const out = new Float32Array(idx.length / 3);
  for (let t = 0; t < out.length; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    out[t] = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return out;
}

function find(parent: Int32Array, t: number): number {
  let r = t;
  while (parent[r] !== r) r = parent[r];
  while (parent[t] !== r) {
    const next = parent[t];
    parent[t] = r;
    t = next;
  }
  return r;
}

function angleDeg(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz);
  if (la === 0 || lb === 0) return 0;
  const d = (ax * bx + ay * by + az * bz) / (la * lb);
  return Math.acos(d > 1 ? 1 : d < -1 ? -1 : d) * RAD_TO_DEG;
}

const ANGLE_BUCKETS = 18001;

function sortByAngle(angle: Float32Array): Uint32Array {
  const counts = new Uint32Array(ANGLE_BUCKETS + 1);
  const bucket = (a: number): number => Math.min(ANGLE_BUCKETS - 1, Math.max(0, Math.round(a * 100)));
  for (let i = 0; i < angle.length; i++) counts[bucket(angle[i]) + 1]++;
  for (let b = 0; b < ANGLE_BUCKETS; b++) counts[b + 1] += counts[b];
  const order = new Uint32Array(angle.length);
  for (let i = 0; i < angle.length; i++) order[counts[bucket(angle[i])]++] = i;
  return order;
}

function segment(m: TriMesh, toleranceDeg: number, adj: Int32Array, normals: Float32Array): Uint32Array {
  const numTri = m.indices.length / 3;
  const areas = triangleAreas(m);
  const parent = new Int32Array(numTri);
  const sum = new Float64Array(numTri * 3);
  const radius = new Float64Array(numTri);
  for (let t = 0; t < numTri; t++) {
    parent[t] = t;
    sum[t * 3] = normals[t * 3] * areas[t];
    sum[t * 3 + 1] = normals[t * 3 + 1] * areas[t];
    sum[t * 3 + 2] = normals[t * 3 + 2] * areas[t];
  }

  let numEdges = 0;
  for (let i = 0; i < adj.length; i++) if (adj[i] > ((i / 3) | 0)) numEdges++;
  const edgeA = new Uint32Array(numEdges);
  const edgeB = new Uint32Array(numEdges);
  const edgeAngle = new Float32Array(numEdges);
  let e = 0;
  for (let i = 0; i < adj.length; i++) {
    const t = (i / 3) | 0, n = adj[i];
    if (n <= t) continue;
    edgeA[e] = t;
    edgeB[e] = n;
    edgeAngle[e] = angleDeg(normals[t * 3], normals[t * 3 + 1], normals[t * 3 + 2], normals[n * 3], normals[n * 3 + 1], normals[n * 3 + 2]);
    e++;
  }
  const order = sortByAngle(edgeAngle);

  for (let i = 0; i < numEdges; i++) {
    const k = order[i];
    const a = find(parent, edgeA[k]), b = find(parent, edgeB[k]);
    if (a === b) continue;
    const ax = sum[a * 3], ay = sum[a * 3 + 1], az = sum[a * 3 + 2];
    const bx = sum[b * 3], by = sum[b * 3 + 1], bz = sum[b * 3 + 2];
    const nx = ax + bx, ny = ay + by, nz = az + bz;
    const ra = angleDeg(nx, ny, nz, ax, ay, az) + radius[a];
    const rb = angleDeg(nx, ny, nz, bx, by, bz) + radius[b];
    const r = ra > rb ? ra : rb;
    if (r > toleranceDeg) continue;
    parent[b] = a;
    sum[a * 3] = nx;
    sum[a * 3 + 1] = ny;
    sum[a * 3 + 2] = nz;
    radius[a] = r;
  }

  const labels = new Uint32Array(numTri);
  const rootLabel = new Int32Array(numTri).fill(-1);
  let next = 0;
  for (let t = 0; t < numTri; t++) {
    const r = find(parent, t);
    if (rootLabel[r] < 0) rootLabel[r] = next++;
    labels[t] = rootLabel[r];
  }
  return labels;
}

/** Label per triangle: connected regions whose normals all lie within toleranceDeg of the region's area-weighted mean normal, numbered densely in order of first triangle. Cached per index array and tolerance. */
export function segmentMesh(m: TriMesh, toleranceDeg: number, adj?: Int32Array, normals?: Float32Array): Uint32Array {
  let byTolerance = segmentCache.get(m.indices);
  if (!byTolerance) {
    byTolerance = new Map();
    segmentCache.set(m.indices, byTolerance);
  }
  let labels = byTolerance.get(toleranceDeg);
  if (!labels) {
    labels = segment(m, toleranceDeg, adj ?? adjacencyOf(m), normals ?? triangleNormals(m));
    byTolerance.set(toleranceDeg, labels);
  }
  return labels;
}

/** Sorted triangles sharing the seed's label; empty when seed is out of range. */
export function selectSegment(m: TriMesh, labels: Uint32Array, seed: number): Uint32Array {
  const numTri = m.indices.length / 3;
  if (seed < 0 || seed >= numTri || seed >= labels.length) return new Uint32Array(0);
  const label = labels[seed];
  let count = 0;
  for (let t = 0; t < labels.length; t++) if (labels[t] === label) count++;
  const out = new Uint32Array(count);
  let j = 0;
  for (let t = 0; t < labels.length; t++) if (labels[t] === label) out[j++] = t;
  return out;
}
