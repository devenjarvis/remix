import type { AppState } from '../app';
import type { FormHandle } from '../panel';
import type { Axis, CutOp } from '../../core/ops/types';
import { newId } from '../../core/ops/types';
import { actions, el, fmt, hint, numberInput, row, select } from '../dom';

const AXIS_INDEX: Record<Axis, number> = { x: 0, y: 1, z: 2 };

export function buildCutForm(host: HTMLElement, app: AppState): FormHandle {
  const axis = select<Axis>([['x', 'X'], ['y', 'Y'], ['z', 'Z']], 'z');
  const slider = el('input', { type: 'range', step: 0.01 });
  const offset = numberInput(0, { step: 0.1 });
  const keep = select<CutOp['keep']>([['both', 'Both'], ['below', 'Below'], ['above', 'Above']], 'both');
  const range = hint();
  const apply = el('button', {
    class: 'primary',
    onClick: () => {
      app.viewport?.hidePlane();
      app.pushOp({ id: newId(), type: 'cut', axis: axis.value as Axis, offset: offset.valueAsNumber, keep: keep.value as CutOp['keep'] });
    },
  }, ['Apply']);

  host.append(row('Axis', axis), row('Offset', slider), row('', offset), range, row('Keep', keep), actions(apply));

  function setBounds(resetValue: boolean): void {
    const b = app.bounds;
    apply.disabled = !b;
    slider.disabled = offset.disabled = !b;
    if (!b) {
      range.textContent = 'No model';
      return;
    }
    const i = AXIS_INDEX[axis.value as Axis];
    const [lo, hi] = [b.min[i], b.max[i]];
    slider.min = offset.min = String(lo);
    slider.max = offset.max = String(hi);
    range.textContent = `Range ${fmt(lo)} – ${fmt(hi)} mm`;
    const current = offset.valueAsNumber;
    const next = resetValue || Number.isNaN(current) ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, current));
    slider.value = offset.value = fmt(next);
  }

  function showPlane(): void {
    const b = app.bounds;
    if (b) app.viewport?.showPlane(axis.value as Axis, offset.valueAsNumber, b);
  }

  slider.addEventListener('input', () => {
    offset.value = slider.value;
    showPlane();
  });
  offset.addEventListener('input', () => {
    if (Number.isNaN(offset.valueAsNumber)) return;
    slider.value = offset.value;
    showPlane();
  });
  axis.addEventListener('change', () => {
    setBounds(true);
    showPlane();
  });

  setBounds(true);
  const off = app.onChange(() => setBounds(false));
  return {
    dispose() {
      off();
      app.viewport?.hidePlane();
    },
  };
}
