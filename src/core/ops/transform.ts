import type { ScaleOp } from './types';
import { registerOp } from './registry';

registerOp<ScaleOp>('scale', (input, op) => input.map((m) => m.scale(op.factors)));
