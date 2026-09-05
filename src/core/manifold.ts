import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';

let instance: ManifoldToplevel | null = null;
let pending: Promise<ManifoldToplevel> | null = null;

export function getManifold(): Promise<ManifoldToplevel> {
  if (instance) return Promise.resolve(instance);
  if (!pending) {
    pending = Module().then((wasm) => {
      wasm.setup();
      instance = wasm;
      return wasm;
    });
  }
  return pending;
}

/** Synchronous access; throws if getManifold() has not resolved yet. */
export function manifold(): ManifoldToplevel {
  if (!instance) throw new Error('manifold-3d is not initialized; await getManifold() first');
  return instance;
}
