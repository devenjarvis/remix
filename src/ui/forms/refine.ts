import type { AppState } from '../app';
import type { FormHandle } from '../panel';
import type { RefineOp } from '../../core/ops/types';
import { newId } from '../../core/ops/types';
import { actions, el, hint, numberInput, row } from '../dom';

export function buildRefineForm(host: HTMLElement, app: AppState): FormHandle {
  const length = numberInput(2, { step: 0.5, min: 0.1 });
  const info = hint();
  let id = newId();
  const op = (): RefineOp => ({ id, type: 'refine', length: length.valueAsNumber });
  const apply = el('button', { class: 'primary', onClick: () => {
    app.pushOp(op());
    id = newId();
  } }, ['Apply']);

  host.append(
    hint('Splits edges longer than the given length so paint boundaries can follow finer triangles. Small triangles are left alone.'),
    row('Max edge', length),
    info,
    actions(apply),
  );

  function preview(): void {
    apply.disabled = !app.canEditGeometry || !(length.valueAsNumber > 0);
    if (!apply.disabled) app.setPreview(op(), 250);
  }

  function refresh(): void {
    if (!app.bounds) {
      info.textContent = 'No model';
      return;
    }
    const tris = app.parts.reduce((n, p) => n + p.indices.length / 3, 0);
    info.textContent = app.preview?.type === 'refine' ? `${tris.toLocaleString()} triangles after refine` : '';
  }

  length.addEventListener('input', preview);
  const off = app.onChange(refresh);
  preview();
  refresh();
  return {
    dispose() {
      off();
      app.setPreview(null);
    },
  };
}
