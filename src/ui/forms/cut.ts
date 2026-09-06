import type { AppState } from '../app';
import type { FormHandle } from '../panel';
import type { Axis, CutOp } from '../../core/ops/types';
import type { Bounds, Vec3 } from '../../core/types';
import { newId } from '../../core/ops/types';
import { axisNormal, offsetRange } from '../../core/ops/cut';
import { actions, el, fmt, hint, numberInput, row, select } from '../dom';

export function buildCutForm(host: HTMLElement, app: AppState): FormHandle {
  let normal: Vec3 = [...axisNormal.z];
  /** The model without this form's preview, so a one-sided cut does not shrink its own offset range. */
  let extent: Bounds | null = app.bounds;
  const slider = el('input', { type: 'range', step: 0.01 });
  const offset = numberInput(0, { step: 0.1 });
  const keep = select<CutOp['keep']>([['both', 'Both'], ['below', 'Below'], ['above', 'Above']], 'both');
  const range = hint();
  const direction = hint();
  let id = newId();
  const op = (): CutOp => ({ id, type: 'cut', normal, offset: offset.valueAsNumber, keep: keep.value as CutOp['keep'] });
  const apply = el('button', {
    class: 'primary',
    onClick: () => {
      app.viewport?.hidePlane();
      app.pushOp(op());
      id = newId();
    },
  }, ['Apply']);

  const axisButton = (axis: Axis) =>
    el('button', { onClick: () => setNormal([...axisNormal[axis]]) }, [axis.toUpperCase()]);
  const pick = el('button', { onClick: () => setPickMode(!picking) }, ['Pick face']);

  host.append(
    row('Plane', axisButton('x'), axisButton('y'), axisButton('z'), pick),
    direction,
    row('Offset', slider),
    row('', offset),
    range,
    row('Keep', keep),
    actions(apply),
  );

  let picking = false;
  let unsubscribe: (() => void) | null = null;

  function setPickMode(on: boolean): void {
    picking = on;
    pick.classList.toggle('active', on);
    unsubscribe?.();
    unsubscribe = null;
    app.viewport?.setPickMode(on);
    if (!on) return;
    unsubscribe = app.viewport?.onFacePick((h) => {
      const at = h.normal[0] * h.point[0] + h.normal[1] * h.point[1] + h.normal[2] * h.point[2];
      setPickMode(false);
      setNormal([...h.normal], at);
    }) ?? null;
  }

  function setNormal(next: Vec3, at?: number): void {
    normal = next;
    setBounds(true, at);
    showPlane();
  }

  function setBounds(resetValue: boolean, at?: number): void {
    const b = extent;
    apply.disabled = !b;
    slider.disabled = offset.disabled = !b;
    direction.textContent = `Normal [${normal.map(fmt).join(', ')}]`;
    if (!b) {
      range.textContent = 'No model';
      return;
    }
    const [lo, hi] = offsetRange(b, normal);
    slider.min = offset.min = String(lo);
    slider.max = offset.max = String(hi);
    range.textContent = `Range ${fmt(lo)} – ${fmt(hi)} mm`;
    const current = at ?? offset.valueAsNumber;
    const next = at === undefined && (resetValue || Number.isNaN(current)) ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, current));
    slider.value = offset.value = fmt(next);
  }

  function showPlane(): void {
    if (!extent) return;
    app.viewport?.showPlane(normal, offset.valueAsNumber, extent);
    app.setPreview(op());
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
  keep.addEventListener('change', showPlane);

  setBounds(true);
  showPlane();
  const off = app.onChange(() => {
    if (!app.preview) extent = app.bounds;
    setBounds(false);
  });
  return {
    dispose() {
      off();
      setPickMode(false);
      app.viewport?.hidePlane();
      app.setPreview(null);
    },
  };
}
