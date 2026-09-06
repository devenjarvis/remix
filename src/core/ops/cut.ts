import type { Manifold } from 'manifold-3d';
import type { Bounds, Vec3 } from '../types';
import { registerOp } from './registry';
import type { Axis, CutOp, SplitOp } from './types';

export const axisNormal: Record<Axis, Vec3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

function nonEmpty(parts: Manifold[]): Manifold[] {
  return parts.filter((p) => {
    if (p.isEmpty()) {
      p.delete();
      return false;
    }
    return true;
  });
}

function sortByMin(parts: Manifold[]): Manifold[] {
  const keyed = parts.map((p) => ({ p, min: p.boundingBox().min }));
  keyed.sort((a, b) => a.min[0] - b.min[0] || a.min[1] - b.min[1] || a.min[2] - b.min[2]);
  return keyed.map((k) => k.p);
}

function unit(v: Vec3): Vec3 {
  const len = Math.hypot(...v) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** Lowest and highest signed distance from the origin to the box, measured along `normal`. */
export function offsetRange(box: Bounds, normal: Vec3): [number, number] {
  const n = unit(normal);
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of [box.min[0], box.max[0]])
    for (const y of [box.min[1], box.max[1]])
      for (const z of [box.min[2], box.max[2]]) {
        const d = x * n[0] + y * n[1] + z * n[2];
        lo = Math.min(lo, d);
        hi = Math.max(hi, d);
      }
  return [lo, hi];
}

registerOp<CutOp>('cut', (input, op) => {
  const normal = unit(op.normal);
  const below: Manifold[] = [];
  const above: Manifold[] = [];
  for (const m of input) {
    const [hi, lo] = m.splitByPlane(normal, op.offset);
    above.push(hi);
    below.push(lo);
  }
  const out: Manifold[] = [];
  if (op.keep === 'both' || op.keep === 'below') out.push(...below);
  else below.forEach((m) => m.delete());
  if (op.keep === 'both' || op.keep === 'above') out.push(...above);
  else above.forEach((m) => m.delete());
  return nonEmpty(out);
});

registerOp<SplitOp>('split', (input, op) => {
  const shells = sortByMin(nonEmpty(input.flatMap((m) => m.decompose())));
  if (op.keep === 'all') return shells;
  const keep = new Set(op.keep);
  return shells.filter((m, i) => {
    if (keep.has(i)) return true;
    m.delete();
    return false;
  });
});
