import type { ManifoldToplevel } from 'manifold-3d';
import type { Vec3 } from '../types';
import type { PaletteSlot } from '../color';

export type Axis = 'x' | 'y' | 'z';

type OpBase = { id: string; type: string };

export type ScaleOp = OpBase & { type: 'scale'; factors: Vec3 };
export type MirrorOp = OpBase & { type: 'mirror'; axis: Axis };
export type RotateOp = OpBase & { type: 'rotate'; axis: Axis; degrees: number };
export type LayFlatOp = OpBase & { type: 'layflat'; normal: Vec3 };
export type CutOp = OpBase & { type: 'cut'; axis: Axis; offset: number; keep: 'both' | 'below' | 'above' };
export type SplitOp = OpBase & { type: 'split'; keep: number[] | 'all' };
export type RefineOp = OpBase & { type: 'refine'; length: number };

export type ToolBody =
  | { kind: 'box' | 'cylinder' | 'sphere'; size: Vec3 }
  | { kind: 'mesh'; name: string; positions: number[]; indices: number[] };

export type BooleanOp = OpBase & {
  type: 'boolean';
  mode: 'union' | 'subtract' | 'intersect';
  tool: ToolBody;
  matrix: number[];
  /** Color slot for surfaces the tool creates; omitted or 0 means Base. */
  color?: number;
};

export type TextOp = OpBase & {
  type: 'text';
  text: string;
  height: number;
  depth: number;
  mode: 'emboss' | 'engrave';
  origin: Vec3;
  normal: Vec3;
  rotation: number;
  /** Color slot for surfaces the text creates; omitted or 0 means Base. */
  color?: number;
};

export type GestureMode = 'add' | 'subtract';

/**
 * One gesture. Region gestures carry `mode` (absent replays as add); `invert`, `grow`, and
 * `shrink` transform the running set. `multi` holds a list applied in order and may not nest.
 */
export type Selection =
  | { kind: 'fill'; part: number; point: Vec3; normal: Vec3; angle: number; rule?: 'seed' | 'crease'; mode?: GestureMode; dam?: boolean }
  | { kind: 'brush'; part: number; points: Vec3[]; normals: Vec3[]; radius: number; mode?: GestureMode; dam?: boolean }
  | { kind: 'segment'; part: number; point: Vec3; normal: Vec3; tolerance: number; mode?: GestureMode }
  | { kind: 'lasso'; part: number; eye: Vec3; polygon: Vec3[]; mode?: GestureMode }
  | { kind: 'height'; min: number; max: number; mode?: GestureMode }
  | { kind: 'part'; index: number; mode?: GestureMode }
  | { kind: 'all'; mode?: GestureMode }
  | { kind: 'invert' }
  | { kind: 'grow'; distance: number }
  | { kind: 'shrink'; distance: number }
  | { kind: 'multi'; selections: Selection[] };

export type RegionSelection = Exclude<Selection, { kind: 'invert' | 'grow' | 'shrink' | 'multi' }>;

export const isRegion = (s: Selection): s is RegionSelection => s.kind !== 'invert' && s.kind !== 'grow' && s.kind !== 'shrink' && s.kind !== 'multi';

/** The one part a gesture applies to, or null when it applies to every part. */
export function gesturePart(sel: Selection): number | null {
  switch (sel.kind) {
    case 'fill':
    case 'brush':
    case 'segment':
    case 'lasso':
      return sel.part;
    case 'part':
      return sel.index;
    default:
      return null;
  }
}

/** `edges` 'smooth' splits boundary triangles along the selection contour; absent replays as 'triangles'. */
export type PaintOp = OpBase & { type: 'paint'; color: number; select: Selection; edges?: 'smooth' | 'triangles' };

export type Op = ScaleOp | MirrorOp | RotateOp | LayFlatOp | CutOp | SplitOp | RefineOp | BooleanOp | TextOp | PaintOp;

export type OpContext = { manifold: ManifoldToplevel; font?: unknown };

export type Recipe = { version: 1 | 2; palette?: PaletteSlot[]; ops: Op[] };

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

/** "fill", or for a multi selection a count per kind such as "2 segments, -1 lasso, 1 grow"; subtract gestures carry a minus. */
export function describeSelection(sel: Selection): string {
  if (sel.kind !== 'multi') return (isRegion(sel) && sel.mode === 'subtract' ? '-' : '') + sel.kind;
  const counts = new Map<string, number>();
  for (const s of sel.selections) {
    const key = (isRegion(s) && s.mode === 'subtract' ? '-' : '') + s.kind;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([kind, n]) => `${kind.startsWith('-') ? '-' : ''}${n} ${kind.replace(/^-/, '')}${n > 1 && kind !== 'all' && kind !== '-all' ? 's' : ''}`).join(', ');
}

export function describeOp(op: Op): string {
  switch (op.type) {
    case 'scale': {
      const [x, y, z] = op.factors;
      return x === y && y === z ? `Scale ${fmt(x)}×` : `Scale ${fmt(x)}×, ${fmt(y)}×, ${fmt(z)}×`;
    }
    case 'mirror':
      return `Mirror ${op.axis.toUpperCase()}`;
    case 'rotate':
      return `Rotate ${op.axis.toUpperCase()} ${fmt(op.degrees)}°`;
    case 'layflat':
      return 'Lay flat';
    case 'cut':
      return `Cut ${op.axis.toUpperCase()} at ${fmt(op.offset)} mm` + (op.keep === 'both' ? '' : ` (keep ${op.keep})`);
    case 'split':
      return op.keep === 'all' ? 'Split parts' : `Split (keep ${op.keep.length})`;
    case 'boolean': {
      const verb = { union: 'Add', subtract: 'Subtract', intersect: 'Intersect' }[op.mode];
      const what = op.tool.kind === 'mesh' ? op.tool.name : op.tool.kind;
      return `${verb} ${what}`;
    }
    case 'text':
      return `${op.mode === 'emboss' ? 'Emboss' : 'Engrave'} "${op.text}"`;
    case 'refine':
      return `Refine to ${fmt(op.length)} mm`;
    case 'paint':
      return `Paint ${op.color === 0 ? 'Base' : `slot ${op.color}`} (${describeSelection(op.select)})`;
    default:
      return `Unknown op ${(op as OpBase).type}`;
  }
}
