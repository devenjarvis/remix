import type { AppState } from '../app';
import { newId } from '../../core/ops/types';

export function buildLayFlatForm(host: HTMLElement, app: AppState): { dispose(): void } {
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = 'Click a face to lay it on the bed';
  host.appendChild(hint);

  app.viewport?.setPickMode(true);
  const unsubscribe = app.viewport?.onFacePick((hit) => {
    app.pushOp({ id: newId(), type: 'layflat', normal: hit.normal });
  });

  return {
    dispose() {
      unsubscribe?.();
      app.viewport?.setPickMode(false);
    },
  };
}
