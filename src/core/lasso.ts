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

/** Sorted triangles that face the eye, whose centroid projects inside the polygon, and whose centroid is visible from the eye. */
export function selectLasso(m: TriMesh, eye: Vec3, polygon: Vec3[], normals = triangleNormals(m), bvh: Bvh = bvhOf(m)): Uint32Array {
  const numTri = m.indices.length / 3;
  const { poly, project } = frameOf(eye, polygon);
  const c: Vec3 = [0, 0, 0];
  const q: [number, number] = [0, 0];
  const picked: number[] = [];
  for (let t = 0; t < numTri; t++) {
    triangleCentroid(m, t, c);
    const fx = eye[0] - c[0], fy = eye[1] - c[1], fz = eye[2] - c[2];
    if (normals[t * 3] * fx + normals[t * 3 + 1] * fy + normals[t * 3 + 2] * fz <= 0) continue;
    if (!project(c[0], c[1], c[2], q) || !insidePolygon(poly, q[0], q[1])) continue;
    if (occluded(bvh, m, eye, c, t)) continue;
    picked.push(t);
  }
  return Uint32Array.from(picked);
}
