import type { Engine, Result } from '../core/engine';
import type { History } from '../core/history';
import type { Axis, Op } from '../core/ops/types';
import type { Bounds, TriMesh, Vec3 } from '../core/types';
import { bounds, mergeMeshes } from '../core/trimesh';

export type FaceHit = { point: Vec3; normal: Vec3; partIndex: number };

/** Implemented by src/ui/viewport.ts. Kept as an interface so forms do not import three. */
export interface ViewportLike {
  setParts(parts: TriMesh[]): void;
  showPlane(axis: Axis, offset: number, extent: Bounds): void;
  hidePlane(): void;
  /** Registers a face-pick listener; returns an unsubscribe. Picks fire only while pick mode is on. */
  onFacePick(cb: (hit: FaceHit) => void): () => void;
  setPickMode(on: boolean): void;
  fitCamera(): void;
}

type Listener = () => void;

export class AppState {
  source: TriMesh | null = null;
  sourceName = 'model';
  result: Result | null = null;
  busy = false;
  viewport: ViewportLike | null = null;
  private listeners = new Set<Listener>();

  constructor(
    public readonly history: History,
    public readonly engine: Engine,
  ) {
    history.onChange(() => void this.refresh());
  }

  onChange(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    for (const cb of this.listeners) cb();
  }

  get parts(): TriMesh[] {
    return this.result?.parts ?? (this.source ? [this.source] : []);
  }

  /** Bounds of all current parts together, or null when nothing is loaded. */
  get bounds(): Bounds | null {
    const parts = this.parts;
    if (!parts.length) return null;
    return bounds(parts.length === 1 ? parts[0] : mergeMeshes(parts));
  }

  get canEditGeometry(): boolean {
    return this.source !== null && this.engine.sourceManifold;
  }

  setSource(m: TriMesh, name: string): void {
    this.source = m;
    this.sourceName = name;
    this.engine.setSource(m);
    this.history.clear();
  }

  pushOp(op: Op): void {
    this.history.push(op);
  }

  async refresh(): Promise<void> {
    if (!this.source) {
      this.result = null;
      this.viewport?.setParts([]);
      this.emit();
      return;
    }
    this.busy = true;
    this.emit();
    try {
      this.result = await this.engine.evaluate(this.history);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.result = { parts: this.result?.parts ?? [this.source], manifold: false, status: 'Error', error: msg };
    } finally {
      this.busy = false;
    }
    this.viewport?.setParts(this.result.parts);
    this.emit();
  }
}
