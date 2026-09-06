import type { TriMesh, Vec3 } from './types';

const LEAF_SIZE = 8;
const T_EPS = 1e-4;
const TARGET_EPS = 1e-4;
const DET_EPS = 1e-12;

const bvhCache = new WeakMap<Uint32Array, Bvh>();

/**
 * Bounding volume hierarchy over triangles. `bounds` holds 6 floats per node (min xyz, max xyz).
 * `nodes` holds 2 ints per node: an interior node stores [left, right] child indices; a leaf
 * stores [-(start + 1), count], addressing a run of triangle indices in `order`.
 */
export type Bvh = { bounds: Float32Array; nodes: Int32Array; order: Uint32Array };

function nthElement(order: Uint32Array, key: Float32Array, axis: number, lo: number, hi: number, k: number): void {
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    const a = key[order[lo] * 3 + axis], b = key[order[mid] * 3 + axis], c = key[order[hi - 1] * 3 + axis];
    const pivot = a < b ? (b < c ? b : a < c ? c : a) : (a < c ? a : b < c ? c : b);
    let i = lo, j = hi - 1;
    while (i <= j) {
      while (key[order[i] * 3 + axis] < pivot) i++;
      while (key[order[j] * 3 + axis] > pivot) j--;
      if (i <= j) {
        const tmp = order[i];
        order[i] = order[j];
        order[j] = tmp;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j + 1;
    else if (k >= i) lo = i;
    else return;
  }
}

/** Builds a median-split BVH with leaves of at most 8 triangles. */
export function buildBvh(m: TriMesh): Bvh {
  const p = m.positions, idx = m.indices;
  const numTri = idx.length / 3;
  const cent = new Float32Array(numTri * 3);
  const triBounds = new Float32Array(numTri * 6);
  for (let t = 0; t < numTri; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    for (let k = 0; k < 3; k++) {
      const x = p[a + k], y = p[b + k], z = p[c + k];
      const lo = x < y ? (x < z ? x : z) : (y < z ? y : z);
      const hi = x > y ? (x > z ? x : z) : (y > z ? y : z);
      triBounds[t * 6 + k] = lo;
      triBounds[t * 6 + 3 + k] = hi;
      cent[t * 3 + k] = (x + y + z) / 3;
    }
  }
  const order = new Uint32Array(numTri);
  for (let t = 0; t < numTri; t++) order[t] = t;
  const capacity = Math.max(1, Math.ceil(numTri / 4) * 2 + 1);
  const bounds = new Float32Array(capacity * 6);
  const nodes = new Int32Array(capacity * 2);
  let numNodes = 1;
  const stack: number[] = [0, 0, numTri];
  while (stack.length) {
    const end = stack.pop()!, start = stack.pop()!, node = stack.pop()!;
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let cMinX = Infinity, cMinY = Infinity, cMinZ = Infinity, cMaxX = -Infinity, cMaxY = -Infinity, cMaxZ = -Infinity;
    for (let i = start; i < end; i++) {
      const t = order[i], b = t * 6, c = t * 3;
      if (triBounds[b] < minX) minX = triBounds[b];
      if (triBounds[b + 1] < minY) minY = triBounds[b + 1];
      if (triBounds[b + 2] < minZ) minZ = triBounds[b + 2];
      if (triBounds[b + 3] > maxX) maxX = triBounds[b + 3];
      if (triBounds[b + 4] > maxY) maxY = triBounds[b + 4];
      if (triBounds[b + 5] > maxZ) maxZ = triBounds[b + 5];
      if (cent[c] < cMinX) cMinX = cent[c];
      if (cent[c + 1] < cMinY) cMinY = cent[c + 1];
      if (cent[c + 2] < cMinZ) cMinZ = cent[c + 2];
      if (cent[c] > cMaxX) cMaxX = cent[c];
      if (cent[c + 1] > cMaxY) cMaxY = cent[c + 1];
      if (cent[c + 2] > cMaxZ) cMaxZ = cent[c + 2];
    }
    bounds[node * 6] = minX;
    bounds[node * 6 + 1] = minY;
    bounds[node * 6 + 2] = minZ;
    bounds[node * 6 + 3] = maxX;
    bounds[node * 6 + 4] = maxY;
    bounds[node * 6 + 5] = maxZ;
    if (end - start <= LEAF_SIZE) {
      nodes[node * 2] = -(start + 1);
      nodes[node * 2 + 1] = end - start;
      continue;
    }
    const ex = cMaxX - cMinX, ey = cMaxY - cMinY, ez = cMaxZ - cMinZ;
    const axis = ex >= ey ? (ex >= ez ? 0 : 2) : (ey >= ez ? 1 : 2);
    const mid = (start + end) >>> 1;
    nthElement(order, cent, axis, start, end, mid);
    const left = numNodes, right = numNodes + 1;
    numNodes += 2;
    nodes[node * 2] = left;
    nodes[node * 2 + 1] = right;
    stack.push(left, start, mid, right, mid, end);
  }
  return { bounds: bounds.slice(0, numNodes * 6), nodes: nodes.slice(0, numNodes * 2), order };
}

/** BVH shared by every caller working on the same index array. */
export function bvhOf(m: TriMesh): Bvh {
  let bvh = bvhCache.get(m.indices);
  if (!bvh) {
    bvh = buildBvh(m);
    bvhCache.set(m.indices, bvh);
  }
  return bvh;
}

const traversal = new Int32Array(128);

/** True when any triangle other than `ignore` is hit strictly between origin and target (parameter in (eps, 1 - eps)). */
export function occluded(bvh: Bvh, m: TriMesh, origin: Vec3, target: Vec3, ignore: number): boolean {
  const { bounds, nodes, order } = bvh;
  const p = m.positions, idx = m.indices;
  const ox = origin[0], oy = origin[1], oz = origin[2];
  const dx = target[0] - ox, dy = target[1] - oy, dz = target[2] - oz;
  const len = Math.hypot(dx, dy, dz);
  if (len <= TARGET_EPS) return false;
  const tMin = T_EPS, tMax = Math.min(1 - T_EPS, 1 - TARGET_EPS / len);
  const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
  let sp = 0;
  traversal[sp++] = 0;
  while (sp > 0) {
    const node = traversal[--sp];
    const b = node * 6;
    let t0 = tMin, t1 = tMax;
    let lo = (bounds[b] - ox) * ix, hi = (bounds[b + 3] - ox) * ix;
    if (dx === 0) { if (ox < bounds[b] || ox > bounds[b + 3]) continue; } else {
      if (lo > hi) { const s = lo; lo = hi; hi = s; }
      if (lo > t0) t0 = lo;
      if (hi < t1) t1 = hi;
    }
    lo = (bounds[b + 1] - oy) * iy;
    hi = (bounds[b + 4] - oy) * iy;
    if (dy === 0) { if (oy < bounds[b + 1] || oy > bounds[b + 4]) continue; } else {
      if (lo > hi) { const s = lo; lo = hi; hi = s; }
      if (lo > t0) t0 = lo;
      if (hi < t1) t1 = hi;
    }
    lo = (bounds[b + 2] - oz) * iz;
    hi = (bounds[b + 5] - oz) * iz;
    if (dz === 0) { if (oz < bounds[b + 2] || oz > bounds[b + 5]) continue; } else {
      if (lo > hi) { const s = lo; lo = hi; hi = s; }
      if (lo > t0) t0 = lo;
      if (hi < t1) t1 = hi;
    }
    if (t0 > t1) continue;
    const first = nodes[node * 2];
    if (first >= 0) {
      traversal[sp++] = first;
      traversal[sp++] = nodes[node * 2 + 1];
      continue;
    }
    const start = -first - 1, end = start + nodes[node * 2 + 1];
    for (let i = start; i < end; i++) {
      const t = order[i];
      if (t === ignore) continue;
      const a = idx[t * 3] * 3, bb = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
      const ax = p[a], ay = p[a + 1], az = p[a + 2];
      const e1x = p[bb] - ax, e1y = p[bb + 1] - ay, e1z = p[bb + 2] - az;
      const e2x = p[c] - ax, e2y = p[c + 1] - ay, e2z = p[c + 2] - az;
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (det > -DET_EPS && det < DET_EPS) continue;
      const inv = 1 / det;
      const sx = ox - ax, sy = oy - ay, sz = oz - az;
      const u = (sx * px + sy * py + sz * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      const hit = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (hit > tMin && hit < tMax) return true;
    }
  }
  return false;
}
