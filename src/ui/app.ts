import type { Engine, Result } from '../core/engine';
import type { History } from '../core/history';
import type { Axis, Op } from '../core/ops/types';
import type { Bounds, TriMesh, Vec3 } from '../core/types';
import { bounds, mergeMeshes, placeOnBed } from '../core/trimesh';
import { repairSmallDefects, type RepairReport } from '../core/repair';
import { validateOp } from '../core/ops/validate';
import { defaultPalette, type PaletteSlot } from '../core/color';

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
  /** Optional until the viewport renders per-triangle colors. */
  setPalette?(hexes: string[]): void;
}

type Listener = () => void;

export class AppState {
  source: TriMesh | null = null;
  sourceName = 'model';
  /** Base plus up to 16 filament slots; index matches TriMesh.colors values. */
  palette: PaletteSlot[] = defaultPalette();
  result: Result | null = null;
  repair: RepairReport | null = null;
  /** An uncommitted op evaluated on top of the active history, shown until cleared or applied. */
  preview: Op | null = null;
  busy = false;
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
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

  setSource(m: TriMesh, name: string, palette?: PaletteSlot[]): void {
    this.palette = palette ?? defaultPalette();
    let mesh = placeOnBed(m);
    this.repair = null;
    this.engine.setSource(mesh);
    if (!this.engine.sourceManifold) {
      const { mesh: fixed, report } = repairSmallDefects(mesh);
      if (report.removedTriangles || report.filledHoles) {
        this.engine.setSource(fixed);
        if (this.engine.sourceManifold) {
          mesh = fixed;
          this.repair = report;
        } else {
          this.engine.setSource(mesh);
        }
      }
    }
    this.source = mesh;
    this.sourceName = name;
    this.history.clear();
  }

  /** Recolors the viewport at once and adds nothing to history. */
  setPalette(p: PaletteSlot[]): void {
    this.palette = p;
    this.viewport?.setPalette?.(p.map((s) => s.hex));
    this.emit();
  }

  pushOp(op: Op): void {
    this.clearPreviewTimer();
    this.preview = null;
    this.history.push(op);
  }

  /** Debounced so sliders and gizmo drags do not queue an evaluation per event. Invalid ops are ignored. */
  setPreview(op: Op | null, delay = 120): void {
    this.clearPreviewTimer();
    if (!op) {
      if (!this.preview) return;
      this.preview = null;
      void this.refresh();
      return;
    }
    let valid: Op;
    try {
      valid = validateOp(op);
    } catch {
      return;
    }
    this.previewTimer = setTimeout(() => {
      this.previewTimer = null;
      this.preview = valid;
      void this.refresh();
    }, delay);
  }

  private clearPreviewTimer(): void {
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = null;
  }

  private pending: Promise<void> | null = null;
  private dirty = false;

  /** Evaluations are serialized: a call during a running evaluation schedules exactly one more run. */
  refresh(): Promise<void> {
    this.dirty = true;
    if (!this.pending) {
      this.pending = (async () => {
        while (this.dirty) {
          this.dirty = false;
          await this.evaluateOnce();
        }
        this.pending = null;
      })();
    }
    return this.pending;
  }

  private async evaluateOnce(): Promise<void> {
    if (!this.source) {
      this.result = null;
      this.viewport?.setParts([]);
      this.emit();
      return;
    }
    this.busy = true;
    this.emit();
    try {
      this.result = await this.engine.evaluate(this.history, this.preview);
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
