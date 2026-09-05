import type { Manifold, Mat4 } from 'manifold-3d';
import type { Vec3 } from '../types';
import type { LayFlatOp } from './types';
import { registerOp } from './registry';

type Mat3 = [Vec3, Vec3, Vec3];

const IDENTITY: Mat3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/** Rotation matrix (rows) taking unit vector `from` onto unit vector `to`. */
export function rotationBetween(from: Vec3, to: Vec3): Mat3 {
  const [ax, ay, az] = [
    from[1] * to[2] - from[2] * to[1],
    from[2] * to[0] - from[0] * to[2],
    from[0] * to[1] - from[1] * to[0],
  ];
  const s = Math.hypot(ax, ay, az);
  const c = from[0] * to[0] + from[1] * to[1] + from[2] * to[2];
  if (s < 1e-9) {
    if (c > 0) return IDENTITY;
    let p: Vec3 = Math.abs(from[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const d = p[0] * from[0] + p[1] * from[1] + p[2] * from[2];
    p = [p[0] - d * from[0], p[1] - d * from[1], p[2] - d * from[2]];
    const l = Math.hypot(...p);
    p = [p[0] / l, p[1] / l, p[2] / l];
    return [
      [2 * p[0] * p[0] - 1, 2 * p[0] * p[1], 2 * p[0] * p[2]],
      [2 * p[1] * p[0], 2 * p[1] * p[1] - 1, 2 * p[1] * p[2]],
      [2 * p[2] * p[0], 2 * p[2] * p[1], 2 * p[2] * p[2] - 1],
    ];
  }
  const [x, y, z] = [ax / s, ay / s, az / s];
  const t = 1 - c;
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
}

function toMat4(r: Mat3): Mat4 {
  return [
    r[0][0], r[1][0], r[2][0], 0,
    r[0][1], r[1][1], r[2][1], 0,
    r[0][2], r[1][2], r[2][2], 0,
    0, 0, 0, 1,
  ];
}

export function layFlat(input: Manifold[], normal: Vec3): Manifold[] {
  const len = Math.hypot(...normal) || 1;
  const n: Vec3 = [normal[0] / len, normal[1] / len, normal[2] / len];
  const m = toMat4(rotationBetween(n, [0, 0, -1]));
  const rotated = input.map((p) => p.transform(m));
  const minZ = Math.min(...rotated.map((p) => p.boundingBox().min[2]));
  const out = rotated.map((p) => p.translate([0, 0, -minZ]));
  for (const p of rotated) p.delete();
  return out;
}

registerOp<LayFlatOp>('layflat', (input, op) => layFlat(input, op.normal));
