import type { TriMesh, Vec3 } from './types';

const NEAREST_DISTANCE = 0.5;
const NEAREST_COS = Math.cos((30 * Math.PI) / 180);

const adjacencyCache = new WeakMap<Uint32Array, Int32Array>();

/** 3 entries per triangle: neighbor triangle index across edge (v0,v1), (v1,v2), (v2,v0); -1 when none. */
export function buildAdjacency(m: TriMesh): Int32Array {
  const idx = m.indices;
  const numTri = idx.length / 3;
  let numVert = 0;
  for (let i = 0; i < idx.length; i++) if (idx[i] >= numVert) numVert = idx[i] + 1;
  const offsets = new Uint32Array(numVert + 1);
  for (let i = 0; i < idx.length; i++) offsets[idx[i] + 1]++;
  for (let v = 0; v < numVert; v++) offsets[v + 1] += offsets[v];
  const incident = new Uint32Array(idx.length);
  const cursor = offsets.slice(0, numVert);
  for (let i = 0; i < idx.length; i++) incident[cursor[idx[i]]++] = (i / 3) | 0;
  const adj = new Int32Array(idx.length).fill(-1);
  for (let t = 0; t < numTri; t++) {
    for (let k = 0; k < 3; k++) {
      const a = idx[t * 3 + k];
      const b = idx[t * 3 + ((k + 1) % 3)];
      for (let j = offsets[b]; j < offsets[b + 1]; j++) {
        const n = incident[j];
        if (n === t) continue;
        const n0 = idx[n * 3], n1 = idx[n * 3 + 1], n2 = idx[n * 3 + 2];
        if ((n0 === b && n1 === a) || (n1 === b && n2 === a) || (n2 === b && n0 === a)) {
          adj[t * 3 + k] = n;
          break;
        }
      }
    }
  }
  return adj;
}

/** Adjacency shared by every caller working on the same index array. */
export function adjacencyOf(m: TriMesh): Int32Array {
  let adj = adjacencyCache.get(m.indices);
  if (!adj) {
    adj = buildAdjacency(m);
    adjacencyCache.set(m.indices, adj);
  }
  return adj;
}

/** Unit normals, 3 floats per triangle. */
export function triangleNormals(m: TriMesh): Float32Array {
  const p = m.positions, idx = m.indices;
  const out = new Float32Array(idx.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    out[t] = nx / len;
    out[t + 1] = ny / len;
    out[t + 2] = nz / len;
  }
  return out;
}

/** Centroid of triangle t. */
export function triangleCentroid(m: TriMesh, t: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const p = m.positions, idx = m.indices;
  const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
  out[0] = (p[a] + p[b] + p[c]) / 3;
  out[1] = (p[a + 1] + p[b + 1] + p[c + 1]) / 3;
  out[2] = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
  return out;
}

function pointTriangleDistance(p: Float32Array, a: number, b: number, c: number, q: Vec3): number {
  const abx = p[b] - p[a], aby = p[b + 1] - p[a + 1], abz = p[b + 2] - p[a + 2];
  const acx = p[c] - p[a], acy = p[c + 1] - p[a + 1], acz = p[c + 2] - p[a + 2];
  const apx = q[0] - p[a], apy = q[1] - p[a + 1], apz = q[2] - p[a + 2];
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return Math.hypot(apx, apy, apz);
  const bpx = q[0] - p[b], bpy = q[1] - p[b + 1], bpz = q[2] - p[b + 2];
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return Math.hypot(bpx, bpy, bpz);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return Math.hypot(apx - v * abx, apy - v * aby, apz - v * abz);
  }
  const cpx = q[0] - p[c], cpy = q[1] - p[c + 1], cpz = q[2] - p[c + 2];
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return Math.hypot(cpx, cpy, cpz);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return Math.hypot(apx - w * acx, apy - w * acy, apz - w * acz);
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return Math.hypot(bpx - w * (p[c] - p[b]), bpy - w * (p[c + 1] - p[b + 1]), bpz - w * (p[c + 2] - p[b + 2]));
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  return Math.hypot(apx - v * abx - w * acx, apy - v * aby - w * acy, apz - v * abz - w * acz);
}

/** Index of the triangle nearest to point whose normal is within 30 degrees of `normal`; -1 when no such triangle lies within 0.5 mm of the point. */
export function nearestTriangle(m: TriMesh, point: Vec3, normal: Vec3, normals = triangleNormals(m)): number {
  const nl = Math.hypot(normal[0], normal[1], normal[2]) || 1;
  const nx = normal[0] / nl, ny = normal[1] / nl, nz = normal[2] / nl;
  const p = m.positions, idx = m.indices;
  let best = -1;
  let bestDist = NEAREST_DISTANCE;
  for (let t = 0; t < idx.length; t += 3) {
    if (normals[t] * nx + normals[t + 1] * ny + normals[t + 2] * nz < NEAREST_COS) continue;
    const d = pointTriangleDistance(p, idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3, point);
    if (d <= bestDist) {
      bestDist = d;
      best = t / 3;
    }
  }
  return best;
}

function flood(m: TriMesh, adj: Int32Array, seed: number, accept: (t: number) => boolean, visited: Uint8Array): void {
  if (seed < 0 || seed * 3 >= m.indices.length || visited[seed] || !accept(seed)) return;
  const stack = [seed];
  visited[seed] = 1;
  while (stack.length) {
    const t = stack.pop()!;
    for (let k = 0; k < 3; k++) {
      const n = adj[t * 3 + k];
      if (n < 0 || visited[n] || !accept(n)) continue;
      visited[n] = 1;
      stack.push(n);
    }
  }
}

function collect(visited: Uint8Array): Uint32Array {
  let count = 0;
  for (let i = 0; i < visited.length; i++) if (visited[i]) count++;
  const out = new Uint32Array(count);
  let j = 0;
  for (let i = 0; i < visited.length; i++) if (visited[i]) out[j++] = i;
  return out;
}

/** BFS from seed crossing an edge only when the neighbor's normal is within angleDeg of the SEED's normal (not the previous triangle's). Returns sorted triangle indices. */
export function selectFill(m: TriMesh, adj: Int32Array, seed: number, angleDeg: number): Uint32Array {
  const visited = new Uint8Array(m.indices.length / 3);
  if (seed < 0 || seed >= visited.length) return new Uint32Array(0);
  const normals = triangleNormals(m);
  const sx = normals[seed * 3], sy = normals[seed * 3 + 1], sz = normals[seed * 3 + 2];
  const minCos = Math.cos((angleDeg * Math.PI) / 180);
  flood(m, adj, seed, (t) => normals[t * 3] * sx + normals[t * 3 + 1] * sy + normals[t * 3 + 2] * sz >= minCos, visited);
  return collect(visited);
}

/** For each (seeds[i], points[i]) pair, BFS from seeds[i] over triangles whose centroid lies within radius of points[i]; union of all, sorted. Seeds equal to -1 are skipped. */
export function selectBrush(m: TriMesh, adj: Int32Array, seeds: number[], points: Vec3[], radius: number): Uint32Array {
  const visited = new Uint8Array(m.indices.length / 3);
  const r2 = radius * radius;
  const c: Vec3 = [0, 0, 0];
  const local = new Uint8Array(visited.length);
  for (let i = 0; i < seeds.length; i++) {
    const q = points[i];
    if (seeds[i] < 0 || !q) continue;
    local.fill(0);
    flood(m, adj, seeds[i], (t) => {
      triangleCentroid(m, t, c);
      const dx = c[0] - q[0], dy = c[1] - q[1], dz = c[2] - q[2];
      return dx * dx + dy * dy + dz * dz <= r2;
    }, local);
    for (let t = 0; t < local.length; t++) if (local[t]) visited[t] = 1;
  }
  return collect(visited);
}

/** Triangles whose centroid z lies in [min, max], sorted. */
export function selectHeight(m: TriMesh, min: number, max: number): Uint32Array {
  const visited = new Uint8Array(m.indices.length / 3);
  const c: Vec3 = [0, 0, 0];
  for (let t = 0; t < visited.length; t++) {
    const z = triangleCentroid(m, t, c)[2];
    if (z >= min && z <= max) visited[t] = 1;
  }
  return collect(visited);
}
