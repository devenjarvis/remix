import type { AppState } from '../app';
import type { FormHandle } from '../panel';
import type { Axis } from '../../core/ops/types';
import type { Vec3 } from '../../core/types';
import { newId } from '../../core/ops/types';
import { scaleFactorsForTarget } from '../../core/ops/transform';
import { actions, el, fmt, hint, numberInput, row, select } from '../dom';

type Mode = 'uniform' | 'axes' | 'size';

export function buildScaleForm(host: HTMLElement, app: AppState): FormHandle {
  const mode = select<Mode>([['uniform', 'Uniform'], ['axes', 'Per axis'], ['size', 'To size']], 'uniform');
  const uniform = numberInput(1, { step: 0.01, min: 0 });
  const axes = [numberInput(1, { step: 0.01, min: 0 }), numberInput(1, { step: 0.01, min: 0 }), numberInput(1, { step: 0.01, min: 0 })];
  const axis = select<Axis>([['x', 'X'], ['y', 'Y'], ['z', 'Z']], 'x');
  const target = numberInput(0, { step: 0.1, min: 0 });
  const size = hint();

  const sections: Record<Mode, HTMLElement[]> = {
    uniform: [row('Factor', uniform)],
    axes: [row('X', axes[0]), row('Y', axes[1]), row('Z', axes[2])],
    size: [row('Axis', axis), row('Target', target)],
  };

  const apply = el('button', { class: 'primary', onClick: () => app.pushOp({ id: newId(), type: 'scale', factors: factors() }) }, ['Apply']);

  host.append(row('Mode', mode), ...Object.values(sections).flat(), size, actions(apply));

  function factors(): Vec3 {
    const b = app.bounds;
    switch (mode.value as Mode) {
      case 'uniform':
        return [uniform.valueAsNumber, uniform.valueAsNumber, uniform.valueAsNumber];
      case 'axes':
        return [axes[0].valueAsNumber, axes[1].valueAsNumber, axes[2].valueAsNumber];
      case 'size':
        return b ? scaleFactorsForTarget(b.size, axis.value as Axis, target.valueAsNumber) : [1, 1, 1];
    }
  }

  function refresh(): void {
    const m = mode.value as Mode;
    for (const [k, nodes] of Object.entries(sections)) for (const n of nodes) n.hidden = k !== m;
    const b = app.bounds;
    size.textContent = b ? `Current size: ${b.size.map(fmt).join(' × ')} mm` : 'No model';
    if (b && m === 'size' && !target.value) target.value = fmt(b.size[{ x: 0, y: 1, z: 2 }[axis.value as Axis]]);
    apply.disabled = !b;
  }

  mode.addEventListener('change', refresh);
  const off = app.onChange(refresh);
  refresh();
  return { dispose: off };
}
