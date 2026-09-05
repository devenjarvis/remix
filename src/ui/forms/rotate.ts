import type { AppState } from '../app';
import type { FormHandle } from '../panel';
import type { Axis, RotateOp } from '../../core/ops/types';
import { newId } from '../../core/ops/types';
import { actions, el, numberInput, row, select } from '../dom';

export function buildRotateForm(host: HTMLElement, app: AppState): FormHandle {
  const axis = select<Axis>([['x', 'X'], ['y', 'Y'], ['z', 'Z']], 'z');
  const degrees = numberInput(90, { step: 1 });
  let id = newId();
  const op = (): RotateOp => ({ id, type: 'rotate', axis: axis.value as Axis, degrees: degrees.valueAsNumber });
  const apply = el('button', { class: 'primary', onClick: () => {
    app.pushOp(op());
    id = newId();
  } }, ['Apply']);
  host.append(row('Axis', axis), row('Degrees', degrees), actions(apply));
  const preview = () => app.setPreview(app.bounds ? op() : null);
  axis.addEventListener('change', preview);
  degrees.addEventListener('input', preview);
  const refresh = () => (apply.disabled = !app.bounds || Number.isNaN(degrees.valueAsNumber));
  refresh();
  preview();
  const off = app.onChange(refresh);
  return {
    dispose() {
      off();
      app.setPreview(null);
    },
  };
}
