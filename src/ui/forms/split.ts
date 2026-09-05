import type { AppState } from '../app';
import type { FormHandle } from '../panel';
import type { SplitOp } from '../../core/ops/types';
import { newId } from '../../core/ops/types';
import { bounds } from '../../core/trimesh';
import { actions, el, fmt, hint } from '../dom';

export function buildSplitForm(host: HTMLElement, app: AppState): FormHandle {
  const info = hint('Finding shells…');
  const list = el('div', { class: 'parts' });
  let id = newId();
  const previewOp = (): SplitOp => ({ id, type: 'split', keep: 'all' });
  const selected = (): number[] =>
    [...list.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].map((c, i) => (c.checked ? i : -1)).filter((i) => i >= 0);

  const apply = el('button', {
    class: 'primary',
    onClick: () => {
      const keep = selected();
      const all = keep.length === list.children.length;
      app.pushOp({ id, type: 'split', keep: all ? 'all' : keep });
      id = newId();
    },
  }, ['Apply']);

  host.append(hint('Separates disconnected shells into parts. Uncheck a part to discard it.'), info, list, actions(apply));

  function refresh(): void {
    if (!app.bounds) {
      info.textContent = 'No model';
      apply.disabled = true;
      return;
    }
    if (app.busy || !app.preview) return;
    const parts = app.parts;
    info.textContent = parts.length > 1 ? `${parts.length} shells found` : 'Model is a single shell; nothing to split';
    apply.disabled = parts.length < 2;
    if (list.children.length === parts.length) return;
    list.replaceChildren(
      ...parts.map((p, i) => {
        const size = bounds(p).size.map(fmt).join('×');
        const box = el('input', { type: 'checkbox', checked: true });
        return el('label', { class: 'row' }, [box, `Part ${i + 1} — ${p.indices.length / 3} tris, ${size} mm`]);
      }),
    );
  }

  list.addEventListener('change', () => (apply.disabled = selected().length === 0));

  const off = app.onChange(refresh);
  refresh();
  app.setPreview(app.bounds ? previewOp() : null, 0);
  return {
    dispose() {
      off();
      app.setPreview(null);
    },
  };
}
