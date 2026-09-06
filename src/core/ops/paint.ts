import type { Manifold } from 'manifold-3d';
import type { TriMesh, Vec3 } from '../types';
import { fromManifold, withPendingPaint } from '../trimesh';
import { adjacencyOf, growSelection, nearestTriangle, selectBrush, selectFill, selectHeight, shrinkSelection, triangleNormals, vertexTriangles, type FillRule } from '../select';
import { segmentMesh, selectSegment } from '../segment';
import { lassoCrossing, lassoField, lassoInside, lassoVisibility } from '../lasso';
import { fractionField, planeField, splitByField } from '../sharpen';
import { registerOp } from './registry';
import { isRegion, type Op, type PaintOp, type RegionSelection, type Selection } from './types';

/**
 * Where lasso visibility is judged: `source` maps each triangle of the working mesh to one of
 * `mesh`, and `visibility` caches the per-gesture visibility on `mesh`.
 */
export type Origin = { mesh: TriMesh; source: Uint32Array; visibility?: Map<Selection, Uint8Array> };

/**
 * Visibility on the origin mesh, tested only for origin triangles under a set `mask` entry of the
 * working mesh. The first call caches, so it must cover every triangle asked about later.
 */
function visibilityOf(origin: Origin, sel: Selection & { kind: 'lasso' }, mask: Uint8Array): Uint8Array {
  let visible = origin.visibility?.get(sel);
  if (!visible) {
    const originMask = new Uint8Array(origin.mesh.indices.length / 3);
    for (let t = 0; t < mask.length; t++) if (mask[t]) originMask[origin.source[t]] = 1;
    visible = lassoVisibility(origin.mesh, sel.eye, undefined, undefined, originMask);
    origin.visibility?.set(sel, visible);
  }
  return visible;
}

function blockedBy(mesh: TriMesh): Uint8Array | undefined {
  if (!mesh.colors) return undefined;
  const out = new Uint8Array(mesh.colors.length);
  for (let t = 0; t < out.length; t++) if (mesh.colors[t]) out[t] = 1;
  return out;
}

function regionTriangles(mesh: TriMesh, sel: RegionSelection, origin?: Origin): Uint32Array | 'all' {
  switch (sel.kind) {
    case 'fill': {
      const seed = nearestTriangle(mesh, sel.point, sel.normal);
      if (seed < 0) throw new Error('Paint target surface not found');
      return selectFill(mesh, adjacencyOf(mesh), seed, sel.angle, sel.rule ?? 'seed', sel.dam ? blockedBy(mesh) : undefined);
    }
    case 'brush': {
      const normals = triangleNormals(mesh);
      const seeds = sel.points.map((p, i) => nearestTriangle(mesh, p, sel.normals[i], normals));
      if (seeds.every((s) => s < 0)) throw new Error('Paint target surface not found');
      return selectBrush(mesh, adjacencyOf(mesh), seeds, sel.points, sel.radius, sel.dam ? blockedBy(mesh) : undefined);
    }
    case 'segment': {
      const seed = nearestTriangle(mesh, sel.point, sel.normal);
      if (seed < 0) throw new Error('Paint target surface not found');
      return selectSegment(mesh, segmentMesh(mesh, sel.tolerance), seed);
    }
    case 'lasso': {
      const inside = lassoInside(mesh, sel.eye, sel.polygon);
      const visible = origin ? visibilityOf(origin, sel, inside) : lassoVisibility(mesh, sel.eye, undefined, undefined, inside);
      const out: number[] = [];
      for (let t = 0; t < inside.length; t++) {
        if (inside[t] && visible[origin ? origin.source[t] : t]) out.push(t);
      }
      return Uint32Array.from(out);
    }
    case 'height':
      return selectHeight(mesh, sel.min, sel.max);
    case 'part':
    case 'all':
      return 'all';
  }
}

/** Applies one gesture to `set` in place. Lasso visibility is judged on `origin` when given, else on `mesh`. */
export function applyGesture(mesh: TriMesh, set: Uint8Array, sel: Selection, origin?: Origin): void {
  switch (sel.kind) {
    case 'invert':
      for (let t = 0; t < set.length; t++) set[t] = set[t] ? 0 : 1;
      return;
    case 'grow':
      set.set(growSelection(mesh, adjacencyOf(mesh), set, sel.distance));
      return;
    case 'shrink':
      set.set(shrinkSelection(mesh, adjacencyOf(mesh), set, sel.distance));
      return;
    case 'multi':
      for (const s of sel.selections) applyGesture(mesh, set, s, origin);
      return;
  }
  const value = sel.mode === 'subtract' ? 0 : 1;
  const picked = regionTriangles(mesh, sel, origin);
  if (picked === 'all') set.fill(value);
  else for (const t of picked) set[t] = value;
}

/** The set of triangles a gesture list selects on `mesh`, one byte per triangle. */
export function resolveSelection(mesh: TriMesh, sels: Selection[], origin?: Origin): Uint8Array {
  const set = new Uint8Array(mesh.indices.length / 3);
  for (const sel of sels) applyGesture(mesh, set, sel, origin);
  return set;
}

function gatedLassoField(mesh: TriMesh, sel: Selection & { kind: 'lasso' }, origin: Origin): Float32Array {
  const field = lassoField(mesh, sel.eye, sel.polygon);
  const mask = lassoInside(mesh, sel.eye, sel.polygon);
  for (let t = 0; t < mask.length; t++) {
    if (field[t * 3] >= 0 || field[t * 3 + 1] >= 0 || field[t * 3 + 2] >= 0) mask[t] = 1;
  }
  const visible = visibilityOf(origin, sel, mask);
  for (let t = 0; t < field.length / 3; t++) {
    if (visible[origin.source[t]]) continue;
    field[t * 3] = field[t * 3 + 1] = field[t * 3 + 2] = -1;
  }
  return field;
}

/**
 * Splits `mesh` on every height plane and visible lasso outline in `sels`. The result's `source`
 * maps back to `mesh` and its `visibility` holds each lasso's visibility on `mesh` for reuse.
 */
export function presplit(mesh: TriMesh, sels: Selection[]): Origin {
  const origin: Origin = { mesh, source: new Uint32Array(mesh.indices.length / 3), visibility: new Map() };
  for (let t = 0; t < origin.source.length; t++) origin.source[t] = t;
  let out = mesh;
  const apply = (field: Float32Array, param?: (u: number, v: number) => number): void => {
    const split = splitByField(out, field, param);
    if (split.mesh === out) return;
    const prev = origin.source;
    origin.source = new Uint32Array(split.source.length);
    for (let t = 0; t < origin.source.length; t++) origin.source[t] = prev[split.source[t]];
    out = split.mesh;
  };
  for (const sel of sels) {
    if (sel.kind === 'height') for (const z of [sel.min, sel.max]) apply(planeField(out, z));
    else if (sel.kind === 'lasso') apply(gatedLassoField(out, sel, origin), lassoCrossing(out, sel.eye, sel.polygon));
  }
  return { ...origin, mesh: out };
}

/**
 * Presplits on height planes and lasso outlines, resolves the gesture list to one set, then splits
 * once along the set's contour. Vertices the presplit created are held on the contour so that split
 * adds nothing along them.
 */
function paintPart(part: Manifold, sels: Selection[], color: number, smooth: boolean): Manifold {
  const base = fromManifold(part);
  const pre = smooth ? presplit(base, sels) : null;
  let mesh = pre ? pre.mesh : base;
  const set = resolveSelection(mesh, sels, pre ? { ...pre, mesh: base } : undefined);
  let picked = set;
  if (!set.some((v) => v)) return part;
  if (smooth) {
    const field = fractionField(mesh, set, triangleNormals(mesh), vertexTriangles(mesh));
    const fixedFrom = base.positions.length / 3;
    for (let i = 0; i < mesh.indices.length; i++) if (mesh.indices[i] >= fixedFrom) field[i] = 0;
    const split = splitByField(mesh, field);
    if (split.mesh !== mesh) {
      const pieces = new Uint8Array(set.length);
      for (const s of split.source) pieces[s]++;
      picked = new Uint8Array(split.source.length);
      for (let t = 0; t < picked.length; t++) {
        const s = split.source[t];
        picked[t] = pieces[s] > 1 ? split.inside[t] : set[s];
      }
      mesh = split.mesh;
    }
  }
  const colors = mesh.colors ? mesh.colors.slice() : new Uint8Array(picked.length);
  for (let t = 0; t < picked.length; t++) if (picked[t]) colors[t] = color;
  return mesh === base ? withPendingPaint(part, colors) : withPendingPaint(part, colors, mesh);
}

function targetIndex(sel: Selection, count: number): number | null {
  const i = sel.kind === 'fill' || sel.kind === 'brush' || sel.kind === 'segment' || sel.kind === 'lasso' ? sel.part : sel.kind === 'part' ? sel.index : null;
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

const addsOnly = (sel: Selection): boolean => flatten(sel).every((g) => isRegion(g) && g.mode !== 'subtract' && !('dam' in g && g.dam));

/**
 * Merges each run of consecutive paint ops with the same color and edges into one multi-selection op
 * keeping the first id. An op is merged into its predecessor only when every gesture in it adds a
 * region without a dam, so subtract, invert, grow, shrink, and dam keep their own step.
 */
export function consolidatePaints(ops: Op[]): Op[] {
  const out: Op[] = [];
  for (const op of ops) {
    const last = out[out.length - 1];
    if (op.type === 'paint' && last?.type === 'paint' && last.color === op.color && last.edges === op.edges && addsOnly(op.select)) {
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
