import type { Op, Recipe, Selection, ToolBody } from './types';
import { HEX_RE, MAX_SLOTS, type PaletteSlot } from '../color';

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

function slot(v: unknown, what = 'color'): number {
  if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > MAX_SLOTS) fail(`${what} must be an integer slot from 0 to ${MAX_SLOTS}`);
  return v as number;
}

function index(v: unknown, what: string): number {
  if (!Number.isInteger(v) || (v as number) < 0) fail(`${what} must be a non-negative integer`);
  return v as number;
}

function unitVec(v: unknown, what: string): [number, number, number] {
  if (!isVec3(v) || Math.hypot(...v) === 0) fail(`${what} must be a non-zero vector`);
  return v;
}

function selection(v: unknown, nested = false): Selection {
  if (!v || typeof v !== 'object') fail('paint select must be an object');
  const s = v as Record<string, unknown>;
  switch (s.kind) {
    case 'fill': {
      if (!isVec3(s.point)) fail('fill point must be a vector');
      const sel: Selection = { kind: 'fill', part: index(s.part, 'part'), point: s.point, normal: unitVec(s.normal, 'fill normal'), angle: num(s.angle, 'angle', 0) };
      if (s.rule !== undefined) sel.rule = oneOf(s.rule, ['seed', 'crease'] as const, 'fill rule');
      return sel;
    }
    case 'multi':
      if (nested) fail('multi selections may not nest');
      if (!Array.isArray(s.selections) || !s.selections.length) fail('multi selections must be a non-empty list');
      return { kind: 'multi', selections: s.selections.map((x) => selection(x, true)) };
    case 'brush': {
      if (!Array.isArray(s.points) || !s.points.length || !s.points.every(isVec3)) fail('brush points must be a non-empty list of vectors');
      if (!Array.isArray(s.normals) || s.normals.length !== s.points.length) fail('brush normals must match points');
      const normals = s.normals.map((n) => unitVec(n, 'brush normal'));
      return { kind: 'brush', part: index(s.part, 'part'), points: s.points as [number, number, number][], normals, radius: num(s.radius, 'radius', 0.001) };
    }
    case 'height': {
      const min = num(s.min, 'min');
      const max = num(s.max, 'max');
      if (max < min) fail('height max must be at least min');
      return { kind: 'height', min, max };
    }
    case 'part':
      return { kind: 'part', index: index(s.index, 'index') };
    case 'all':
      return { kind: 'all' };
    default:
      return fail(`unknown selection kind ${String(s.kind)}`);
  }
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
    case 'refine':
      return { id, type: 'refine', length: num(o.length, 'length', 0.01) };
    case 'split':
      if (o.keep !== 'all' && !(Array.isArray(o.keep) && o.keep.every((i) => Number.isInteger(i) && i >= 0))) fail('split keep must be "all" or non-negative integers');
      return { id, type: 'split', keep: o.keep as number[] | 'all' };
    case 'boolean': {
      if (!Array.isArray(o.matrix) || o.matrix.length !== 16 || !o.matrix.every((n) => typeof n === 'number' && Number.isFinite(n))) fail('matrix must be 16 finite numbers');
      const op: Op = { id, type: 'boolean', mode: oneOf(o.mode, ['union', 'subtract', 'intersect'] as const, 'mode'), tool: tool(o.tool), matrix: o.matrix as number[] };
      if (o.color !== undefined) op.color = slot(o.color);
      return op;
    }
    case 'text': {
      if (typeof o.text !== 'string' || !o.text.trim()) fail('text must be a non-empty string');
      if (!isVec3(o.origin) || !isVec3(o.normal) || Math.hypot(...o.normal) === 0) fail('text needs origin and a non-zero normal');
      const op: Op = {
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
      if (o.color !== undefined) op.color = slot(o.color);
      return op;
    }
    case 'paint': {
      const op: Op = { id, type: 'paint', color: slot(o.color), select: selection(o.select) };
      if (o.edges !== undefined) op.edges = oneOf(o.edges, ['smooth', 'triangles'] as const, 'edges');
      return op;
    }
    default:
      return fail(`unknown op type ${String(o.type)}`);
  }
}

export function validatePalette(v: unknown): PaletteSlot[] {
  if (!Array.isArray(v) || !v.length || v.length > MAX_SLOTS + 1) fail(`palette must list 1 to ${MAX_SLOTS + 1} slots`);
  return v.map((s) => {
    if (!s || typeof s !== 'object') fail('palette slot must be an object');
    const { name, hex } = s as Record<string, unknown>;
    if (typeof name !== 'string') fail('palette slot name must be a string');
    if (typeof hex !== 'string' || !HEX_RE.test(hex)) fail('palette slot hex must be #RRGGBB');
    return { name, hex };
  });
}

export function validateRecipe(v: unknown): Recipe {
  if (!v || typeof v !== 'object') fail('not an object');
  const r = v as Record<string, unknown>;
  if (r.version !== 1 && r.version !== 2) fail(`unsupported version ${String(r.version)}`);
  if (!Array.isArray(r.ops)) fail('ops must be an array');
  const recipe: Recipe = { version: r.version, ops: r.ops.map(validateOp) };
  if (r.version === 2 && r.palette !== undefined) recipe.palette = validatePalette(r.palette);
  return recipe;
}
