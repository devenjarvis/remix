import type { AppState } from '../app';
import type { FormHandle } from '../panel';
import type { Axis, MirrorOp } from '../../core/ops/types';
import { newId } from '../../core/ops/types';
import { actions, el, hint, row, select } from '../dom';

export function buildMirrorForm(host: HTMLElement, app: AppState): FormHandle {
  const axis = select<Axis>([['x', 'X'], ['y', 'Y'], ['z', 'Z']], 'x');
  let id = newId();
  const op = (): MirrorOp => ({ id, type: 'mirror', axis: axis.value as Axis });
  const apply = el('button', { class: 'primary', onClick: () => {
    app.pushOp(op());
    id = newId();
  } }, ['Apply']);
  host.append(row('Axis', axis), hint('Flips the model across the plane perpendicular to the axis.'), actions(apply));
  const preview = () => app.setPreview(app.bounds ? op() : null);
  axis.addEventListener('change', preview);
  const refresh = () => (apply.disabled = !app.bounds);
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
