import type { Manifold } from 'manifold-3d';
import type { Op, OpContext } from './types';

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
  return handler(input, op, ctx);
}
