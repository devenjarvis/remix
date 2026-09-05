import type { Manifold } from 'manifold-3d';
import type { TriMesh, Vec3 } from '../types';
import { fromManifold, withPendingPaint } from '../trimesh';
import { adjacencyOf, nearestTriangle, selectBrush, selectFill, selectHeight, triangleNormals, vertexTriangles, type FillRule } from '../select';
import { fractionField, planeField, splitByField } from '../sharpen';
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

/** Splits `mesh` along the contour of `sel` and returns the triangles to paint on the split mesh. */
function splitSelection(mesh: TriMesh, sel: Selection): { mesh: TriMesh; picked: Uint32Array | 'all' } {
  if (sel.kind === 'height') {
    let out = mesh;
    for (const z of [sel.min, sel.max]) out = splitByField(out, planeField(out, z)).mesh;
    return { mesh: out, picked: selectHeight(out, sel.min, sel.max) };
  }
  const picked = selectTriangles(mesh, sel);
  if (picked === 'all' || picked.length === 0) return { mesh, picked };
  const numTri = mesh.indices.length / 3;
  const selected = new Uint8Array(numTri);
  for (const t of picked) selected[t] = 1;
  const split = splitByField(mesh, fractionField(mesh, selected, triangleNormals(mesh), vertexTriangles(mesh)));
  if (split.mesh === mesh) return { mesh, picked };
  const pieces = new Uint8Array(numTri);
  for (const s of split.source) pieces[s]++;
  const out: number[] = [];
  for (let t = 0; t < split.source.length; t++) {
    const s = split.source[t];
    if (pieces[s] > 1 ? split.inside[t] : selected[s]) out.push(t);
  }
  return { mesh: split.mesh, picked: Uint32Array.from(out) };
}

function paintPart(part: Manifold, sels: Selection[], color: number, smooth: boolean): Manifold {
  const base = fromManifold(part);
  let mesh = base;
  let colors: Uint8Array | null = null;
  for (const sel of sels) {
    let picked: Uint32Array | 'all';
    if (smooth && sel.kind !== 'part' && sel.kind !== 'all') {
      const split = splitSelection(colors ? { ...mesh, colors } : mesh, sel);
      if (split.mesh !== mesh) {
        mesh = split.mesh;
        colors = mesh.colors ?? null;
      }
      picked = split.picked;
    } else picked = selectTriangles(mesh, sel);
    if (picked !== 'all' && picked.length === 0) continue;
    colors ??= mesh.colors ? mesh.colors.slice() : new Uint8Array(mesh.indices.length / 3);
    if (picked === 'all') colors.fill(color);
    else for (const t of picked) colors[t] = color;
  }
  if (!colors) return part;
  return mesh === base ? withPendingPaint(part, colors) : withPendingPaint(part, colors, mesh);
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
    return mine.length ? paintPart(p, mine, op.color, op.edges === 'smooth') : p;
  });
});

/** Merges each run of consecutive paint ops with the same color and edges into one multi-selection op keeping the first id. */
export function consolidatePaints(ops: Op[]): Op[] {
  const out: Op[] = [];
  for (const op of ops) {
    const last = out[out.length - 1];
    if (op.type === 'paint' && last?.type === 'paint' && last.color === op.color && last.edges === op.edges) {
      out[out.length - 1] = { ...last, select: { kind: 'multi', selections: [...flatten(last.select), ...flatten(op.select)] } };
    } else out.push(op);
  }
  return out;
}

export function paintOpFromHit(hit: { point: Vec3; normal: Vec3; partIndex: number }, color: number, angle: number, id: string, rule: FillRule = 'seed', edges: PaintOp['edges'] = 'smooth'): PaintOp {
  return { id, type: 'paint', color, edges, select: { kind: 'fill', part: hit.partIndex, point: hit.point, normal: hit.normal, angle, rule } };
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
