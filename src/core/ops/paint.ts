import type { Manifold } from 'manifold-3d';
import type { TriMesh, Vec3 } from '../types';
import { fromManifold, withPendingPaint } from '../trimesh';
import { adjacencyOf, nearestTriangle, selectBrush, selectFill, selectHeight, triangleNormals, type FillRule } from '../select';
import { registerOp } from './registry';
import type { Op, PaintOp, Selection } from './types';

function selectTriangles(mesh: TriMesh, sel: Selection): Uint32Array | 'all' {
  switch (sel.kind) {
    case 'fill': {
      const seed = nearestTriangle(mesh, sel.point, sel.normal);
      if (seed < 0) throw new Error('Paint target surface not found');
      return selectFill(mesh, adjacencyOf(mesh), seed, sel.angle, sel.rule ?? 'seed');
    }
    case 'brush': {
      const normals = triangleNormals(mesh);
      const seeds = sel.points.map((p, i) => nearestTriangle(mesh, p, sel.normals[i], normals));
      if (seeds.every((s) => s < 0)) throw new Error('Paint target surface not found');
      return selectBrush(mesh, adjacencyOf(mesh), seeds, sel.points, sel.radius);
    }
    case 'height':
      return selectHeight(mesh, sel.min, sel.max);
    case 'part':
    case 'all':
      return 'all';
    case 'multi':
      throw new Error('multi selections are expanded before selection');
  }
}

function paintPart(part: Manifold, sels: Selection[], color: number): Manifold {
  const mesh = fromManifold(part);
  let colors: Uint8Array | null = null;
  for (const sel of sels) {
    const picked = selectTriangles(mesh, sel);
    if (picked !== 'all' && picked.length === 0) continue;
    colors ??= mesh.colors ? mesh.colors.slice() : new Uint8Array(mesh.indices.length / 3);
    if (picked === 'all') colors.fill(color);
    else for (const t of picked) colors[t] = color;
  }
  return colors ? withPendingPaint(part, colors) : part;
}

function targetIndex(sel: Selection, count: number): number | null {
  const i = sel.kind === 'fill' || sel.kind === 'brush' ? sel.part : sel.kind === 'part' ? sel.index : null;
  if (i !== null && i >= count) throw new Error(`Paint target part ${i + 1} not found`);
  return i;
}

const flatten = (sel: Selection): Selection[] => (sel.kind === 'multi' ? sel.selections : [sel]);

registerOp<PaintOp>('paint', (input, op) => {
  const sels = flatten(op.select);
  const targets = sels.map((s) => targetIndex(s, input.length));
  return input.map((p, i) => {
    const mine = sels.filter((_, k) => targets[k] === null || targets[k] === i);
    return mine.length ? paintPart(p, mine, op.color) : p;
  });
});

/** Merges each run of consecutive paint ops with the same color into one multi-selection op keeping the first id. */
export function consolidatePaints(ops: Op[]): Op[] {
  const out: Op[] = [];
  for (const op of ops) {
    const last = out[out.length - 1];
    if (op.type === 'paint' && last?.type === 'paint' && last.color === op.color) {
      out[out.length - 1] = { ...last, select: { kind: 'multi', selections: [...flatten(last.select), ...flatten(op.select)] } };
    } else out.push(op);
  }
  return out;
}

export function paintOpFromHit(hit: { point: Vec3; normal: Vec3; partIndex: number }, color: number, angle: number, id: string, rule: FillRule = 'seed'): PaintOp {
  return { id, type: 'paint', color, select: { kind: 'fill', part: hit.partIndex, point: hit.point, normal: hit.normal, angle, rule } };
}

/** Keeps the first point and every later point at least `spacing` from the last kept point. */
export function thinStroke(points: Vec3[], normals: Vec3[], spacing: number): { points: Vec3[]; normals: Vec3[] } {
  const outP: Vec3[] = [];
  const outN: Vec3[] = [];
  for (let i = 0; i < points.length; i++) {
    const last = outP[outP.length - 1];
    if (last && Math.hypot(points[i][0] - last[0], points[i][1] - last[1], points[i][2] - last[2]) < spacing) continue;
    outP.push(points[i]);
    outN.push(normals[i]);
  }
  return { points: outP, normals: outN };
}
