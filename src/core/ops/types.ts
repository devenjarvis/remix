import type { ManifoldToplevel } from 'manifold-3d';
import type { Vec3 } from '../types';

export type Axis = 'x' | 'y' | 'z';

type OpBase = { id: string; type: string };

export type ScaleOp = OpBase & { type: 'scale'; factors: Vec3 };
export type MirrorOp = OpBase & { type: 'mirror'; axis: Axis };
export type RotateOp = OpBase & { type: 'rotate'; axis: Axis; degrees: number };
export type LayFlatOp = OpBase & { type: 'layflat'; normal: Vec3 };
export type CutOp = OpBase & { type: 'cut'; axis: Axis; offset: number; keep: 'both' | 'below' | 'above' };
export type SplitOp = OpBase & { type: 'split'; keep: number[] | 'all' };

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

export type Selection =
  | { kind: 'fill'; part: number; point: Vec3; normal: Vec3; angle: number }
  | { kind: 'brush'; part: number; points: Vec3[]; normals: Vec3[]; radius: number }
  | { kind: 'height'; min: number; max: number }
  | { kind: 'part'; index: number }
  | { kind: 'all' };

export type PaintOp = OpBase & { type: 'paint'; color: number; select: Selection };

export type Op = ScaleOp | MirrorOp | RotateOp | LayFlatOp | CutOp | SplitOp | BooleanOp | TextOp | PaintOp;

export type OpContext = { manifold: ManifoldToplevel; font?: unknown };

export type Recipe = { version: 1; ops: Op[] };

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

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
    case 'paint':
      return `Paint ${op.color === 0 ? 'Base' : `slot ${op.color}`} (${op.select.kind})`;
    default:
      return `Unknown op ${(op as OpBase).type}`;
  }
}
