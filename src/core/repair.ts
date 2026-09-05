import type { TriMesh } from './types';

export type RepairReport = { removedTriangles: number; filledHoles: number; filledTriangles: number };

const MAX_HOLE_EDGES = 32;

function edgeKey(u: number, v: number): number {
  return u * 4294967296 + v;
}

/**
 * Removes degenerate and duplicate triangles, drops triangles that repeat an
 * already-used directed edge (flipped or extra faces), then fan-fills small
 * boundary loops. Meant for tiny defects; large holes are left alone.
 */
export function repairSmallDefects(m: TriMesh): { mesh: TriMesh; report: RepairReport } {
  const idx = m.indices;
  const kept: number[] = [];
  const directed = new Set<number>();
  const seenTri = new Set<string>();
  let removed = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (a === b || b === c || a === c) {
      removed++;
      continue;
    }
    const key = [a, b, c].sort((x, y) => x - y).join(',');
    if (seenTri.has(key)) {
      removed++;
      continue;
    }
    const e = [edgeKey(a, b), edgeKey(b, c), edgeKey(c, a)];
    if (e.some((k) => directed.has(k))) {
      removed++;
      continue;
    }
    seenTri.add(key);
    for (const k of e) directed.add(k);
    kept.push(a, b, c);
  }

  const next = new Map<number, number>();
  for (let t = 0; t < kept.length; t += 3) {
    const a = kept[t], b = kept[t + 1], c = kept[t + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      if (directed.has(edgeKey(v, u))) continue;
      next.set(v, u);
    }
  }

  let holes = 0;
  let filled = 0;
  const visited = new Set<number>();
  for (const start of next.keys()) {
    if (visited.has(start)) continue;
    const loop: number[] = [];
    let v: number | undefined = start;
    while (v !== undefined && !visited.has(v)) {
      visited.add(v);
      loop.push(v);
      v = next.get(v);
    }
    if (v !== start || loop.length < 3 || loop.length > MAX_HOLE_EDGES) continue;
    for (let i = 1; i < loop.length - 1; i++) kept.push(loop[0], loop[i], loop[i + 1]);
    holes++;
    filled += loop.length - 2;
  }

  return {
    mesh: { positions: m.positions, indices: Uint32Array.from(kept) },
    report: { removedTriangles: removed, filledHoles: holes, filledTriangles: filled },
  };
}
