import type { Manifold } from 'manifold-3d';
import { toolManifold } from '../tools';
import { registerOp } from './registry';
import type { BooleanOp } from './types';

function overlaps(a: Manifold, b: Manifold): boolean {
  const x = a.boundingBox();
  const y = b.boundingBox();
  for (let k = 0; k < 3; k++) if (x.max[k] < y.min[k] || y.max[k] < x.min[k]) return false;
  return true;
}

registerOp<BooleanOp>('boolean', (input, op) => {
  const tool = toolManifold(op.tool, op.matrix);
  if (!input.length) return op.mode === 'union' ? [tool] : (tool.delete(), []);
  try {
    if (op.mode === 'union') {
      let target = input.findIndex((p) => overlaps(p, tool));
      if (target < 0) target = 0;
      return input.map((p, i) => (i === target ? p.add(tool) : p));
    }
    const out = input.map((p) => (op.mode === 'subtract' ? p.subtract(tool) : p.intersect(tool)));
    return out.filter((p) => {
      if (p.isEmpty()) {
        p.delete();
        return false;
      }
      return true;
    });
  } finally {
    tool.delete();
  }
});
