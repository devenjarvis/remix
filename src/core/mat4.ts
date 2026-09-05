import type { Vec3 } from './types';

/** Column-major 4x4, matching manifold-3d Mat4 and three.js Matrix4.elements. */
export type Mat4 = number[];

export const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function fromAxes(x: Vec3, y: Vec3, z: Vec3, origin: Vec3): Mat4 {
  return [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, origin[0], origin[1], origin[2], 1];
}

export function rotateAboutAxis(axis: Vec3, degrees: number, v: Vec3): Vec3 {
  const k = normalize(axis);
  const t = (degrees * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const kv = cross(k, v);
  const kd = dot(k, v);
  return [
    v[0] * c + kv[0] * s + k[0] * kd * (1 - c),
    v[1] * c + kv[1] * s + k[1] * kd * (1 - c),
    v[2] * c + kv[2] * s + k[2] * kd * (1 - c),
  ];
}

/**
 * Local frame on a face: z = normal, y = world +Z projected onto the face
 * (world +Y when the face is horizontal), rotated by `rotation` degrees about the normal.
 */
export function faceFrame(origin: Vec3, normal: Vec3, rotation = 0): Mat4 {
  const n = normalize(normal);
  const up: Vec3 = Math.abs(n[2]) > 0.99 ? [0, 1, 0] : [0, 0, 1];
  let x = normalize(cross(up, n));
  let y = normalize(cross(n, x));
  if (rotation) {
    x = rotateAboutAxis(n, rotation, x);
    y = rotateAboutAxis(n, rotation, y);
  }
  return fromAxes(x, y, n, origin);
}
