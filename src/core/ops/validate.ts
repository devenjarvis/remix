import type { Op, Recipe, ToolBody } from './types';

const AXES = ['x', 'y', 'z'];

function fail(msg: string): never {
  throw new Error(`Invalid recipe: ${msg}`);
}

function isVec3(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function num(v: unknown, what: string, min = -Infinity): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min) fail(`${what} must be a finite number${min > -Infinity ? ` >= ${min}` : ''}`);
  return v;
}

function axis(v: unknown): 'x' | 'y' | 'z' {
  if (typeof v !== 'string' || !AXES.includes(v)) fail('axis must be x, y, or z');
  return v as 'x' | 'y' | 'z';
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], what: string): T {
  if (typeof v !== 'string' || !allowed.includes(v as T)) fail(`${what} must be one of ${allowed.join(', ')}`);
  return v as T;
}

function tool(v: unknown): ToolBody {
  if (!v || typeof v !== 'object') fail('tool must be an object');
  const t = v as Record<string, unknown>;
  if (t.kind === 'mesh') {
    if (typeof t.name !== 'string') fail('mesh tool needs a name');
    if (!Array.isArray(t.positions) || !Array.isArray(t.indices)) fail('mesh tool needs positions and indices');
    if (t.positions.length % 3 || t.indices.length % 3 || !t.indices.length) fail('mesh tool arrays must be multiples of 3');
    const nv = t.positions.length / 3;
    for (const p of t.positions) if (typeof p !== 'number' || !Number.isFinite(p)) fail('mesh tool positions must be finite numbers');
    for (const i of t.indices) if (!Number.isInteger(i) || (i as number) < 0 || (i as number) >= nv) fail('mesh tool index out of range');
    return { kind: 'mesh', name: t.name, positions: t.positions as number[], indices: t.indices as number[] };
  }
  const kind = oneOf(t.kind, ['box', 'cylinder', 'sphere'] as const, 'tool kind');
  if (!isVec3(t.size) || t.size.some((n) => n <= 0)) fail('tool size must be three positive numbers');
  return { kind, size: t.size };
}

export function validateOp(v: unknown): Op {
  if (!v || typeof v !== 'object') fail('op must be an object');
  const o = v as Record<string, unknown>;
  const id = typeof o.id === 'string' && o.id ? o.id : fail('op needs an id');
  switch (o.type) {
    case 'scale':
      if (!isVec3(o.factors) || o.factors.some((n) => n <= 0)) fail('scale factors must be three positive numbers');
      return { id, type: 'scale', factors: o.factors };
    case 'mirror':
      return { id, type: 'mirror', axis: axis(o.axis) };
    case 'rotate':
      return { id, type: 'rotate', axis: axis(o.axis), degrees: num(o.degrees, 'degrees') };
    case 'layflat':
      if (!isVec3(o.normal) || Math.hypot(...o.normal) === 0) fail('layflat normal must be a non-zero vector');
      return { id, type: 'layflat', normal: o.normal };
    case 'cut':
      return { id, type: 'cut', axis: axis(o.axis), offset: num(o.offset, 'offset'), keep: oneOf(o.keep, ['both', 'below', 'above'] as const, 'keep') };
    case 'split':
      if (o.keep !== 'all' && !(Array.isArray(o.keep) && o.keep.every((i) => Number.isInteger(i) && i >= 0))) fail('split keep must be "all" or non-negative integers');
      return { id, type: 'split', keep: o.keep as number[] | 'all' };
    case 'boolean': {
      if (!Array.isArray(o.matrix) || o.matrix.length !== 16 || !o.matrix.every((n) => typeof n === 'number' && Number.isFinite(n))) fail('matrix must be 16 finite numbers');
      return { id, type: 'boolean', mode: oneOf(o.mode, ['union', 'subtract', 'intersect'] as const, 'mode'), tool: tool(o.tool), matrix: o.matrix as number[] };
    }
    case 'text':
      if (typeof o.text !== 'string' || !o.text.trim()) fail('text must be a non-empty string');
      if (!isVec3(o.origin) || !isVec3(o.normal) || Math.hypot(...o.normal) === 0) fail('text needs origin and a non-zero normal');
      return {
        id,
        type: 'text',
        text: o.text,
        height: num(o.height, 'height', 0.01),
        depth: num(o.depth, 'depth', 0.01),
        mode: oneOf(o.mode, ['emboss', 'engrave'] as const, 'mode'),
        origin: o.origin,
        normal: o.normal,
        rotation: num(o.rotation ?? 0, 'rotation'),
      };
    default:
      return fail(`unknown op type ${String(o.type)}`);
  }
}

export function validateRecipe(v: unknown): Recipe {
  if (!v || typeof v !== 'object') fail('not an object');
  const r = v as Record<string, unknown>;
  if (r.version !== 1) fail(`unsupported version ${String(r.version)}`);
  if (!Array.isArray(r.ops)) fail('ops must be an array');
  return { version: 1, ops: r.ops.map(validateOp) };
}
