import type { Manifold } from 'manifold-3d';
import type { Vec3 } from '../types';
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

registerOp<CutOp>('cut', (input, op) => {
  const normal = axisNormal[op.axis];
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
