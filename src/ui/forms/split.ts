import type { AppState } from '../app';
import type { FormHandle } from '../panel';
import { newId } from '../../core/ops/types';
import { bounds } from '../../core/trimesh';
import { actions, el, fmt, hint } from '../dom';

export function buildSplitForm(host: HTMLElement, app: AppState): FormHandle {
  const split = el('button', { class: 'primary', onClick: () => app.pushOp({ id: newId(), type: 'split', keep: 'all' }) }, ['Split into parts']);
  const list = el('div', { class: 'parts' });
  const keepSelected = el('button', {
    class: 'primary',
    onClick: () => {
      const keep = [...list.querySelectorAll<HTMLInputElement>('input[type=checkbox]')]
        .map((c, i) => (c.checked ? i : -1))
        .filter((i) => i >= 0);
      app.pushOp({ id: newId(), type: 'split', keep });
    },
  }, ['Keep selected']);
  const selection = el('div', {}, [hint('Uncheck parts to discard'), list, actions(keepSelected)]);

  host.append(hint('Separate disconnected shells into individual parts'), actions(split), selection);

  function refresh(): void {
    const parts = app.parts;
    split.disabled = !parts.length;
    const last = app.history.active.at(-1);
    selection.hidden = !(parts.length > 1 && last?.type === 'split');
    if (selection.hidden) return;
    list.replaceChildren(
      ...parts.map((p, i) => {
        const size = bounds(p).size.map(fmt).join('×');
        const box = el('input', { type: 'checkbox', checked: true });
        return el('label', { class: 'row' }, [box, `Part ${i + 1} — ${p.indices.length / 3} tris, ${size} mm`]);
      }),
    );
    keepSelected.disabled = false;
  }

  list.addEventListener('change', () => {
    keepSelected.disabled = ![...list.querySelectorAll<HTMLInputElement>('input')].some((c) => c.checked);
  });

  refresh();
  return { dispose: app.onChange(refresh) };
}
