import type { AppState } from '../app';
import type { FormHandle } from '../panel';
import type { Axis } from '../../core/ops/types';
import { newId } from '../../core/ops/types';
import { actions, el, numberInput, row, select } from '../dom';

export function buildRotateForm(host: HTMLElement, app: AppState): FormHandle {
  const axis = select<Axis>([['x', 'X'], ['y', 'Y'], ['z', 'Z']], 'z');
  const degrees = numberInput(90, { step: 1 });
  const apply = el('button', {
    class: 'primary',
    onClick: () => app.pushOp({ id: newId(), type: 'rotate', axis: axis.value as Axis, degrees: degrees.valueAsNumber || 0 }),
  }, ['Apply']);
  host.append(row('Axis', axis), row('Degrees', degrees), actions(apply));
  const refresh = () => (apply.disabled = !app.bounds);
  refresh();
  return { dispose: app.onChange(refresh) };
}
