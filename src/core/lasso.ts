import type { TriMesh, Vec3 } from './types';
import { triangleCentroid, triangleNormals } from './select';
import { type Bvh, bvhOf, occluded } from './bvh';

const BEHIND = -1e9;
const PARALLEL_EPS = 1e-12;

type Frame = {
  /** Plane coordinates of the polygon, 2 per point. */
  poly: Float64Array;
  /** Projects world point (x, y, z) from the eye onto the plane; false when behind the eye or parallel. */
  project: (x: number, y: number, z: number, out: [number, number]) => boolean;
};

function frameOf(eye: Vec3, polygon: Vec3[]): Frame {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl;
  ny /= nl;
  nz /= nl;
  const o = polygon[0] ?? [0, 0, 0];
  if (nx * (eye[0] - o[0]) + ny * (eye[1] - o[1]) + nz * (eye[2] - o[2]) < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  let ux: number, uy: number, uz: number;
  if (Math.abs(nx) < 0.9) { ux = 0; uy = nz; uz = -ny; } else { ux = -nz; uy = 0; uz = nx; }
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul;
  uy /= ul;
  uz /= ul;
  const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
  const poly = new Float64Array(polygon.length * 2);
  for (let i = 0; i < polygon.length; i++) {
    const px = polygon[i][0] - o[0], py = polygon[i][1] - o[1], pz = polygon[i][2] - o[2];
    poly[i * 2] = px * ux + py * uy + pz * uz;
    poly[i * 2 + 1] = px * vx + py * vy + pz * vz;
  }
  const ex = eye[0], ey = eye[1], ez = eye[2];
  const planeDot = nx * (o[0] - ex) + ny * (o[1] - ey) + nz * (o[2] - ez);
  const project = (x: number, y: number, z: number, out: [number, number]): boolean => {
    const dx = x - ex, dy = y - ey, dz = z - ez;
    const denom = nx * dx + ny * dy + nz * dz;
    if (denom > -PARALLEL_EPS) return false;
    const s = planeDot / denom;
    const px = ex + s * dx - o[0], py = ey + s * dy - o[1], pz = ez + s * dz - o[2];
    out[0] = px * ux + py * uy + pz * uz;
    out[1] = px * vx + py * vy + pz * vz;
    return true;
  };
  return { poly, project };
}

function insidePolygon(poly: Float64Array, x: number, y: number): boolean {
  const n = poly.length / 2;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2], yi = poly[i * 2 + 1], xj = poly[j * 2], yj = poly[j * 2 + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function signedDistance(poly: Float64Array, x: number, y: number): number {
  const n = poly.length / 2;
  let best = Infinity;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = poly[j * 2], ay = poly[j * 2 + 1];
    const ex = poly[i * 2] - ax, ey = poly[i * 2 + 1] - ay;
    const len2 = ex * ex + ey * ey;
    let s = len2 > 0 ? ((x - ax) * ex + (y - ay) * ey) / len2 : 0;
    s = s < 0 ? 0 : s > 1 ? 1 : s;
    const dx = x - ax - s * ex, dy = y - ay - s * ey;
    const d2 = dx * dx + dy * dy;
    if (d2 < best) best = d2;
  }
  const d = Math.sqrt(best);
  return insidePolygon(poly, x, y) ? d : -d;
}

/** 3 per triangle: signed distance of each corner's projection from `eye` onto the polygon plane, to the polygon boundary; positive inside. */
export function lassoField(m: TriMesh, eye: Vec3, polygon: Vec3[]): Float32Array {
  const p = m.positions, idx = m.indices;
  const { poly, project } = frameOf(eye, polygon);
  const numVert = p.length / 3;
  const perVertex = new Float32Array(numVert);
  const q: [number, number] = [0, 0];
  for (let v = 0; v < numVert; v++) {
    perVertex[v] = project(p[v * 3], p[v * 3 + 1], p[v * 3 + 2], q) ? signedDistance(poly, q[0], q[1]) : BEHIND;
  }
  const out = new Float32Array(idx.length);
  for (let i = 0; i < idx.length; i++) out[i] = perVertex[idx[i]];
  return out;
}

/**
 * Crossing parameter along mesh edge (u, v) of the outline swept from the eye through the polygon,
 * for use as the `param` of splitByField; NaN when no polygon edge crosses it.
 */
export function lassoCrossing(m: TriMesh, eye: Vec3, polygon: Vec3[]): (u: number, v: number) => number {
  const p = m.positions;
  const n = polygon.length;
  const planes = new Float64Array(n * 4);
  for (let i = 0; i < n; i++) {
    const a = polygon[i], b = polygon[(i + 1) % n];
    const ax = a[0] - eye[0], ay = a[1] - eye[1], az = a[2] - eye[2];
    const bx = b[0] - eye[0], by = b[1] - eye[1], bz = b[2] - eye[2];
    planes[i * 4] = ay * bz - az * by;
    planes[i * 4 + 1] = az * bx - ax * bz;
    planes[i * 4 + 2] = ax * by - ay * bx;
  }
  const { poly, project } = frameOf(eye, polygon);
  const q: [number, number] = [0, 0];
  return (u, v) => {
    let best = NaN;
    for (let i = 0; i < n; i++) {
      const nx = planes[i * 4], ny = planes[i * 4 + 1], nz = planes[i * 4 + 2];
      const fu = nx * (p[u * 3] - eye[0]) + ny * (p[u * 3 + 1] - eye[1]) + nz * (p[u * 3 + 2] - eye[2]);
      const fv = nx * (p[v * 3] - eye[0]) + ny * (p[v * 3 + 1] - eye[1]) + nz * (p[v * 3 + 2] - eye[2]);
      if (!(fu * fv < 0)) continue;
      const t = fu / (fu - fv);
      if (!(Number.isNaN(best) || t < best)) continue;
      const x = p[u * 3] + (p[v * 3] - p[u * 3]) * t, y = p[u * 3 + 1] + (p[v * 3 + 1] - p[u * 3 + 1]) * t, z = p[u * 3 + 2] + (p[v * 3 + 2] - p[u * 3 + 2]) * t;
      if (!project(x, y, z, q)) continue;
      const j = (i + 1) % n;
      const ex = poly[j * 2] - poly[i * 2], ey = poly[j * 2 + 1] - poly[i * 2 + 1];
      const s = ((q[0] - poly[i * 2]) * ex + (q[1] - poly[i * 2 + 1]) * ey) / (ex * ex + ey * ey || 1);
      if (s >= 0 && s <= 1) best = t;
    }
    return best;
  };
}

/** 1 per triangle that faces the eye and whose centroid is not occluded from it; triangles with `mask` 0 are skipped and left 0. */
export function lassoVisibility(m: TriMesh, eye: Vec3, normals = triangleNormals(m), bvh: Bvh = bvhOf(m), mask?: Uint8Array): Uint8Array {
  const out = new Uint8Array(m.indices.length / 3);
  const c: Vec3 = [0, 0, 0];
  for (let t = 0; t < out.length; t++) {
    if (mask && !mask[t]) continue;
    triangleCentroid(m, t, c);
    const fx = eye[0] - c[0], fy = eye[1] - c[1], fz = eye[2] - c[2];
    if (normals[t * 3] * fx + normals[t * 3 + 1] * fy + normals[t * 3 + 2] * fz <= 0) continue;
    if (!occluded(bvh, m, eye, c, t)) out[t] = 1;
  }
  return out;
}

/** 1 per triangle whose centroid projects from the eye inside the polygon, regardless of visibility. */
export function lassoInside(m: TriMesh, eye: Vec3, polygon: Vec3[]): Uint8Array {
  const out = new Uint8Array(m.indices.length / 3);
  const { poly, project } = frameOf(eye, polygon);
  const c: Vec3 = [0, 0, 0];
  const q: [number, number] = [0, 0];
  for (let t = 0; t < out.length; t++) {
    triangleCentroid(m, t, c);
    if (project(c[0], c[1], c[2], q) && insidePolygon(poly, q[0], q[1])) out[t] = 1;
  }
  return out;
}

/** Sorted triangles that face the eye, whose centroid projects inside the polygon, and whose centroid is visible from the eye. */
export function selectLasso(m: TriMesh, eye: Vec3, polygon: Vec3[], normals = triangleNormals(m), bvh: Bvh = bvhOf(m)): Uint32Array {
  const inside = lassoInside(m, eye, polygon);
  const visible = lassoVisibility(m, eye, normals, bvh, inside);
  const picked: number[] = [];
  for (let t = 0; t < inside.length; t++) if (inside[t] && visible[t]) picked.push(t);
  return Uint32Array.from(picked);
}
