import type { Manifold } from 'manifold-3d';
import type { Op, OpContext } from './types';
import { bakePaint } from '../trimesh';

export type OpHandler<T extends Op = Op> = (
  input: Manifold[],
  op: T,
  ctx: OpContext,
) => Manifold[] | Promise<Manifold[]>;

const registry = new Map<string, OpHandler>();

export function registerOp<T extends Op>(type: T['type'], handler: OpHandler<T>): void {
  registry.set(type, handler as OpHandler);
}

export function hasOp(type: string): boolean {
  return registry.has(type);
}

export async function applyOp(input: Manifold[], op: Op, ctx: OpContext): Promise<Manifold[]> {
  const handler = registry.get(op.type);
  if (!handler) throw new Error(`Unknown op type: ${op.type}`);
  if (op.type === 'paint') return handler(input, op, ctx);
  const baked = input.map(bakePaint);
  const fresh = baked.filter((m, i) => m !== input[i]);
  let out: Manifold[];
  try {
    out = await handler(baked, op, ctx);
  } catch (e) {
    for (const m of fresh) m.delete();
    throw e;
  }
  for (const m of fresh) if (!out.includes(m)) m.delete();
  return out;
}
