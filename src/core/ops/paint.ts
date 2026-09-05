import type { Manifold } from 'manifold-3d';
import type { TriMesh, Vec3 } from '../types';
import { fromManifold, withPendingPaint } from '../trimesh';
import { adjacencyOf, nearestTriangle, selectBrush, selectFill, selectHeight, triangleNormals } from '../select';
import { registerOp } from './registry';
import type { PaintOp, Selection } from './types';

function selectTriangles(mesh: TriMesh, sel: Selection): Uint32Array | 'all' {
  switch (sel.kind) {
    case 'fill': {
      const seed = nearestTriangle(mesh, sel.point, sel.normal);
      if (seed < 0) throw new Error('Paint target surface not found');
      return selectFill(mesh, adjacencyOf(mesh), seed, sel.angle);
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
  }
}

function paintPart(part: Manifold, sel: Selection, color: number): Manifold {
  const mesh = fromManifold(part);
  const picked = selectTriangles(mesh, sel);
  if (picked !== 'all' && picked.length === 0) return part;
  const colors = mesh.colors ? mesh.colors.slice() : new Uint8Array(mesh.indices.length / 3);
  if (picked === 'all') colors.fill(color);
  else for (const t of picked) colors[t] = color;
  return withPendingPaint(part, colors);
}

function targetIndex(sel: Selection, count: number): number | null {
  const i = sel.kind === 'fill' || sel.kind === 'brush' ? sel.part : sel.kind === 'part' ? sel.index : null;
  if (i !== null && i >= count) throw new Error(`Paint target part ${i + 1} not found`);
  return i;
}

registerOp<PaintOp>('paint', (input, op) => {
  const target = targetIndex(op.select, input.length);
  return input.map((p, i) => (target === null || target === i ? paintPart(p, op.select, op.color) : p));
});

export function paintOpFromHit(hit: { point: Vec3; normal: Vec3; partIndex: number }, color: number, angle: number, id: string): PaintOp {
  return { id, type: 'paint', color, select: { kind: 'fill', part: hit.partIndex, point: hit.point, normal: hit.normal, angle } };
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
