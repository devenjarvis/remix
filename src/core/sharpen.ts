import type { TriMesh } from './types';
import { adjacencyOf, type VertexTriangles } from './select';

const SMOOTH_COS = Math.cos((40 * Math.PI) / 180);
const SNAP_FRACTION = 0.05;
const STRAIGHT_COS = Math.cos((30 * Math.PI) / 180);
const MIN_PARAM = 0.02;
const MAX_PARAM = 0.98;
const MIN_SPAN = 1e-6;

export type SplitResult = { mesh: TriMesh; source: Uint32Array; inside: Uint8Array };

function cornerAngle(p: Float32Array, idx: Uint32Array, t: number, v: number): number {
  const k = idx[t * 3] === v ? 0 : idx[t * 3 + 1] === v ? 1 : 2;
  const a = idx[t * 3 + k] * 3, b = idx[t * 3 + ((k + 1) % 3)] * 3, c = idx[t * 3 + ((k + 2) % 3)] * 3;
  const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
  const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
  const cross = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  return Math.atan2(cross, ux * vx + uy * vy + uz * vz);
}

/** 1 per vertex that ends an edge whose two triangles differ in selection. */
function boundaryVertices(m: TriMesh, selected: Uint8Array, adj: Int32Array, numVert: number): Uint8Array {
  const idx = m.indices;
  const out = new Uint8Array(numVert);
  for (let t = 0; t < selected.length; t++) {
    for (let k = 0; k < 3; k++) {
      const n = adj[t * 3 + k];
      if (n >= 0 && selected[n] === selected[t]) continue;
      out[idx[t * 3 + k]] = 1;
      out[idx[t * 3 + ((k + 1) % 3)]] = 1;
    }
  }
  return out;
}

/**
 * Per-corner selected fraction minus 0.5, 3 values per triangle, weighting each incident triangle
 * by its corner angle at the vertex. A corner counts only the incident triangles whose normal lies
 * within 40 degrees of the triangle's own normal, so a boundary on a sharp crease stays on the crease.
 * A vertex whose fraction is within 0.05 of one half, or where the selection boundary runs through
 * it with a turn of at most 30 degrees, gets exactly 0, so a contour that already lies on mesh
 * edges is kept rather than shifted by a sliver.
 */
export function fractionField(m: TriMesh, selected: Uint8Array, normals: Float32Array, vt: VertexTriangles, adj = adjacencyOf(m)): Float32Array {
  const idx = m.indices, p = m.positions;
  const numVert = vt.offsets.length - 1;
  const boundary = boundaryVertices(m, selected, adj, numVert);
  const onContour = new Uint8Array(numVert);
  const ends = [0, 0];
  for (let v = 0; v < numVert; v++) {
    if (!boundary[v]) continue;
    let count = 0, crease = false;
    for (let j = vt.offsets[v]; j < vt.offsets[v + 1] && !crease; j++) {
      const n = vt.incident[j];
      const k = idx[n * 3] === v ? 0 : idx[n * 3 + 1] === v ? 1 : 2;
      const across = adj[n * 3 + k];
      if (across < 0 || selected[n] === selected[across]) continue;
      const dot = normals[n * 3] * normals[across * 3] + normals[n * 3 + 1] * normals[across * 3 + 1] + normals[n * 3 + 2] * normals[across * 3 + 2];
      if (dot < SMOOTH_COS) crease = true;
      else if (count < 2) ends[count++] = idx[n * 3 + ((k + 1) % 3)];
      else count++;
    }
    if (crease || count !== 2) continue;
    const a = ends[0] * 3, b = ends[1] * 3, c = v * 3;
    const ux = p[c] - p[a], uy = p[c + 1] - p[a + 1], uz = p[c + 2] - p[a + 2];
    const wx = p[b] - p[c], wy = p[b + 1] - p[c + 1], wz = p[b + 2] - p[c + 2];
    const len = Math.hypot(ux, uy, uz) * Math.hypot(wx, wy, wz);
    if (len > 0 && (ux * wx + uy * wy + uz * wz) / len >= STRAIGHT_COS) onContour[v] = 1;
  }
  const out = new Float32Array(idx.length);
  for (let t = 0; t < idx.length / 3; t++) {
    const nx = normals[t * 3], ny = normals[t * 3 + 1], nz = normals[t * 3 + 2];
    for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k];
      if (onContour[v]) continue;
      if (!boundary[v]) {
        out[t * 3 + k] = selected[t] ? 0.5 : -0.5;
        continue;
      }
      let total = 0, picked = 0;
      for (let j = vt.offsets[v]; j < vt.offsets[v + 1]; j++) {
        const n = vt.incident[j];
        if (normals[n * 3] * nx + normals[n * 3 + 1] * ny + normals[n * 3 + 2] * nz < SMOOTH_COS) continue;
        const w = cornerAngle(p, idx, n, v);
        total += w;
        if (selected[n]) picked += w;
      }
      const f = total > 0 ? picked / total - 0.5 : selected[t] ? 0.5 : -0.5;
      out[t * 3 + k] = Math.abs(f) < SNAP_FRACTION ? 0 : f;
    }
  }
  return out;
}

/** Signed height above the plane z at each corner, 3 values per triangle. */
export function planeField(m: TriMesh, z: number): Float32Array {
  const idx = m.indices, p = m.positions;
  const out = new Float32Array(idx.length);
  for (let i = 0; i < idx.length; i++) out[i] = p[idx[i] * 3 + 2] - z;
  return out;
}

/**
 * Splits every triangle whose field changes sign along the 0 iso-line. Each crossed edge gets one
 * new vertex shared by both adjacent triangles. A crossing within 2% of either endpoint is not split,
 * so the contour snaps to that vertex. `param` may give the crossing parameter along edge (u, v)
 * instead of linear interpolation; NaN falls back to interpolation. `source` maps output triangles to input triangles;
 * `inside` marks output triangles whose centroid field value is positive. Returns the input arrays
 * by reference when no edge is crossed.
 */
export function splitByField(m: TriMesh, field: Float32Array, param?: (u: number, v: number, fu: number, fv: number) => number): SplitResult {
  const idx = m.indices, p = m.positions;
  const numTri = idx.length / 3;
  const numVert = p.length / 3;
  const edgeVertex = new Map<number, number>();
  const added: number[] = [];
  const claim = (u: number, v: number, fu: number, fv: number): void => {
    if (!(fu * fv < 0) || Math.abs(fu - fv) < MIN_SPAN) return;
    const key = u < v ? u * numVert + v : v * numVert + u;
    if (edgeVertex.has(key)) return;
    let t = param ? param(u, v, fu, fv) : NaN;
    if (Number.isNaN(t)) t = fu / (fu - fv);
    if (t < MIN_PARAM || t > MAX_PARAM) return;
    edgeVertex.set(key, numVert + added.length / 3);
    for (let k = 0; k < 3; k++) added.push(p[u * 3 + k] + (p[v * 3 + k] - p[u * 3 + k]) * t);
  };
  for (let t = 0; t < numTri; t++) {
    for (let k = 0; k < 3; k++) {
      const u = idx[t * 3 + k], v = idx[t * 3 + ((k + 1) % 3)];
      claim(u, v, field[t * 3 + k], field[t * 3 + ((k + 1) % 3)]);
    }
  }
  if (!added.length) {
    const source = new Uint32Array(numTri);
    const inside = new Uint8Array(numTri);
    for (let t = 0; t < numTri; t++) {
      source[t] = t;
      inside[t] = field[t * 3] + field[t * 3 + 1] + field[t * 3 + 2] > 0 ? 1 : 0;
    }
    return { mesh: m, source, inside };
  }

  const positions = new Float32Array(p.length + added.length);
  positions.set(p);
  positions.set(added, p.length);
  const outIdx: number[] = [];
  const outSrc: number[] = [];
  const outIn: number[] = [];
  const edgeOf = (u: number, v: number): number => edgeVertex.get(u < v ? u * numVert + v : v * numVert + u) ?? -1;
  const dist2 = (a: number, b: number): number => {
    const dx = positions[a * 3] - positions[b * 3], dy = positions[a * 3 + 1] - positions[b * 3 + 1], dz = positions[a * 3 + 2] - positions[b * 3 + 2];
    return dx * dx + dy * dy + dz * dz;
  };
  const corners = [0, 0, 0], values = [0, 0, 0], mids = [0, 0, 0], midValues = [0, 0, 0];
  const emit = (t: number, a: number, b: number, c: number, fa: number, fb: number, fc: number): void => {
    outIdx.push(a, b, c);
    outSrc.push(t);
    outIn.push(fa + fb + fc > 0 ? 1 : 0);
  };
  const midValue = (u: number, v: number, fu: number, fv: number, mid: number): number => {
    const lo = u < v ? u : v, hi = u < v ? v : u;
    const dx = positions[mid * 3] - positions[lo * 3], dy = positions[mid * 3 + 1] - positions[lo * 3 + 1], dz = positions[mid * 3 + 2] - positions[lo * 3 + 2];
    const ex = positions[hi * 3] - positions[lo * 3], ey = positions[hi * 3 + 1] - positions[lo * 3 + 1], ez = positions[hi * 3 + 2] - positions[lo * 3 + 2];
    const s = (dx * ex + dy * ey + dz * ez) / (ex * ex + ey * ey + ez * ez || 1);
    const flo = u < v ? fu : fv, fhi = u < v ? fv : fu;
    return flo + (fhi - flo) * s;
  };
  for (let t = 0; t < numTri; t++) {
    let count = 0, first = -1;
    for (let k = 0; k < 3; k++) {
      corners[k] = idx[t * 3 + k];
      values[k] = field[t * 3 + k];
    }
    for (let k = 0; k < 3; k++) {
      mids[k] = edgeOf(corners[k], corners[(k + 1) % 3]);
      if (mids[k] >= 0) {
        count++;
        if (first < 0) first = k;
        midValues[k] = midValue(corners[k], corners[(k + 1) % 3], values[k], values[(k + 1) % 3], mids[k]);
      }
    }
    if (count === 0) {
      emit(t, corners[0], corners[1], corners[2], values[0], values[1], values[2]);
      continue;
    }
    let r = first;
    if (count === 2) r = mids[(first + 2) % 3] >= 0 ? (first + 2) % 3 : first;
    const a = corners[r], b = corners[(r + 1) % 3], c = corners[(r + 2) % 3];
    const fa = values[r], fb = values[(r + 1) % 3], fc = values[(r + 2) % 3];
    const ab = mids[r], bc = mids[(r + 1) % 3], ca = mids[(r + 2) % 3];
    const fab = midValues[r], fbc = midValues[(r + 1) % 3], fca = midValues[(r + 2) % 3];
    if (count === 1) {
      emit(t, a, ab, c, fa, fab, fc);
      emit(t, ab, b, c, fab, fb, fc);
    } else if (count === 2) {
      emit(t, ab, b, bc, fab, fb, fbc);
      if (dist2(a, bc) <= dist2(ab, c)) {
        emit(t, a, ab, bc, fa, fab, fbc);
        emit(t, a, bc, c, fa, fbc, fc);
      } else {
        emit(t, a, ab, c, fa, fab, fc);
        emit(t, ab, bc, c, fab, fbc, fc);
      }
    } else {
      emit(t, a, ab, ca, fa, fab, fca);
      emit(t, b, bc, ab, fb, fbc, fab);
      emit(t, c, ca, bc, fc, fca, fbc);
      emit(t, ab, bc, ca, fab, fbc, fca);
    }
  }
  const source = Uint32Array.from(outSrc);
  const mesh: TriMesh = { positions, indices: Uint32Array.from(outIdx) };
  if (m.colors) {
    const colors = new Uint8Array(source.length);
    for (let t = 0; t < source.length; t++) colors[t] = m.colors[source[t]];
    mesh.colors = colors;
  }
  return { mesh, source, inside: Uint8Array.from(outIn) };
}
