import type { AppState } from '../app';
import type { FormHandle } from '../panel';
import type { Axis } from '../../core/ops/types';
import { newId } from '../../core/ops/types';
import { actions, el, hint, row, select } from '../dom';

export function buildMirrorForm(host: HTMLElement, app: AppState): FormHandle {
  const axis = select<Axis>([['x', 'X'], ['y', 'Y'], ['z', 'Z']], 'x');
  const apply = el('button', { class: 'primary', onClick: () => app.pushOp({ id: newId(), type: 'mirror', axis: axis.value as Axis }) }, ['Apply']);
  host.append(row('Axis', axis), hint('Flips the model across the plane perpendicular to the axis.'), actions(apply));
  const refresh = () => (apply.disabled = !app.bounds);
  refresh();
  return { dispose: app.onChange(refresh) };
}
