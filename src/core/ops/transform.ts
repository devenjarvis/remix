import type { Vec3 } from '../types';
import type { Axis, MirrorOp, RefineOp, RotateOp, ScaleOp } from './types';
import { registerOp } from './registry';

export const AXIS_INDEX: Record<Axis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };

export function scaleFactorsForTarget(size: Vec3, axis: Axis, target: number): Vec3 {
  const current = size[AXIS_INDEX[axis]];
  const f = current > 0 ? target / current : 1;
  return [f, f, f];
}

function axisVec(axis: Axis, value: number): Vec3 {
  const v: Vec3 = [0, 0, 0];
  v[AXIS_INDEX[axis]] = value;
  return v;
}

registerOp<ScaleOp>('scale', (input, op) => input.map((m) => m.scale(op.factors)));
registerOp<MirrorOp>('mirror', (input, op) => input.map((m) => m.mirror(axisVec(op.axis, 1))));
registerOp<RotateOp>('rotate', (input, op) => input.map((m) => m.rotate(axisVec(op.axis, op.degrees))));
registerOp<RefineOp>('refine', (input, op) => input.map((m) => m.refineToLength(op.length)));
