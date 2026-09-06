import { applyGesture } from '../core/ops/paint';
import { gesturePart, type Selection } from '../core/ops/types';
import type { TriMesh } from '../core/types';

type Cached = { indices: Uint32Array; set: Uint8Array };

function applies(g: Selection, part: number): boolean {
  const p = gesturePart(g);
  return p === null || p === part;
}

/** A gesture whose target surface is gone selects nothing rather than failing the whole selection. */
function applySafely(mesh: TriMesh, set: Uint8Array, g: Selection): void {
  try {
    applyGesture(mesh, set, g);
  } catch {
    return;
  }
}

/**
 * The gesture list being built in the Paint form, with one cached set per part. A new gesture is
 * applied incrementally; undo, clear, or a part whose index array changed recompute from scratch.
 */
export class LiveSelection {
  gestures: Selection[] = [];
  private cache: (Cached | undefined)[] = [];

  get isEmpty(): boolean {
    return this.gestures.length === 0;
  }

  private setFor(parts: TriMesh[], i: number): Uint8Array {
    const part = parts[i];
    const cached = this.cache[i];
    if (cached && cached.indices === part.indices) return cached.set;
    const set = new Uint8Array(part.indices.length / 3);
    for (const g of this.gestures) if (applies(g, i)) applySafely(part, set, g);
    this.cache[i] = { indices: part.indices, set };
    return set;
  }

  sets(parts: TriMesh[]): Uint8Array[] {
    this.cache.length = parts.length;
    return parts.map((_, i) => this.setFor(parts, i));
  }

  add(g: Selection, parts: TriMesh[]): void {
    const sets = this.sets(parts);
    this.gestures.push(g);
    parts.forEach((part, i) => {
      if (applies(g, i)) applySafely(part, sets[i], g);
    });
  }

  undo(): void {
    this.gestures.pop();
    this.cache = [];
  }

  clear(): void {
    this.gestures = [];
    this.cache = [];
  }
}
