import type { Manifold } from 'manifold-3d';
import type { TriMesh } from './types';
import type { History } from './history';
import type { Op, OpContext } from './ops/types';
import { applyOp } from './ops';
import { getManifold } from './manifold';
import { fromManifold, toManifold } from './trimesh';

export type Result = { parts: TriMesh[]; manifold: boolean; status: string; error?: string };

export class Engine {
  private source: TriMesh | null = null;
  private base: Manifold | null = null;
  private baseStatus = 'NoError';
  private keys: string[] = [];
  private cache: Manifold[][] = [];
  font: unknown = null;

  setSource(m: TriMesh): void {
    this.invalidateFrom(0);
    this.base?.delete();
    this.base = null;
    this.source = m;
    this.baseStatus = 'NoError';
    try {
      const mf = toManifold(m);
      const status = mf.status();
      if (status === 'NoError' && !mf.isEmpty()) {
        this.base = mf;
      } else {
        this.baseStatus = mf.isEmpty() ? 'Empty mesh' : status;
        mf.delete();
      }
    } catch (e) {
      this.baseStatus = e instanceof Error ? e.message : String(e);
    }
  }

  get sourceManifold(): boolean {
    return this.base !== null;
  }

  /** Handlers may pass untouched parts through by reference, so only free objects no earlier level still holds. */
  private invalidateFrom(i: number): void {
    const retained = new Set<Manifold>();
    if (this.base) retained.add(this.base);
    for (let k = 0; k < i && k < this.cache.length; k++) for (const m of this.cache[k]) retained.add(m);
    for (let k = i; k < this.cache.length; k++) {
      for (const m of this.cache[k]) {
        if (retained.has(m)) continue;
        retained.add(m);
        m.delete();
      }
    }
    this.cache.length = Math.min(i, this.cache.length);
    this.keys.length = Math.min(i, this.keys.length);
  }

  async evaluate(h: History, preview: Op | null = null): Promise<Result> {
    const ops = preview ? [...h.active, preview] : h.active;
    if (!this.source) return { parts: [], manifold: false, status: 'No source' };
    if (!this.base) {
      const r: Result = { parts: [this.source], manifold: false, status: this.baseStatus };
      if (ops.length) r.error = `Source mesh is not manifold (${this.baseStatus}); cannot apply ${ops[0].type}`;
      return r;
    }
    if (!ops.length) return { parts: [this.source], manifold: true, status: this.base.status() };
    const ctx: OpContext = { manifold: await getManifold(), font: this.font ?? undefined };
    let start = 0;
    while (start < ops.length && start < this.keys.length && this.keys[start] === keyOf(ops[start])) start++;
    this.invalidateFrom(start);
    let parts: Manifold[] = start === 0 ? [this.base] : this.cache[start - 1];
    for (let i = start; i < ops.length; i++) {
      try {
        parts = await applyOp(parts, ops[i], ctx);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { parts: parts.map(fromManifold), manifold: true, status: statusOf(parts), error: msg };
      }
      this.cache.push(parts);
      this.keys.push(keyOf(ops[i]));
    }
    return { parts: parts.map(fromManifold), manifold: true, status: statusOf(parts) };
  }
}

function keyOf(op: Op): string {
  return JSON.stringify(op);
}

function statusOf(parts: Manifold[]): string {
  return parts.length ? parts[parts.length - 1].status() : 'NoError';
}
