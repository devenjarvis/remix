import type { AppState, FaceHit } from '../app';
import type { FormHandle } from '../panel';
import { newId } from '../../core/ops/types';
import { getFont } from '../../core/font';
import { actions, el, fmt, hint, numberInput, row, select } from '../dom';

type Mode = 'emboss' | 'engrave';

export function buildTextForm(host: HTMLElement, app: AppState): FormHandle {
  const text = el('input', { type: 'text' });
  text.value = 'TEXT';
  const height = numberInput(8, { step: 0.5, min: 0.1 });
  const depth = numberInput(1, { step: 0.1, min: 0.01 });
  const mode = select<Mode>([['emboss', 'Emboss'], ['engrave', 'Engrave']], 'emboss');
  const rotation = numberInput(0, { step: 1 });
  const pickHint = hint('Click a face to place the text');
  const fontHint = hint('Loading font…');

  let hit: FaceHit | null = null;
  let fontReady = false;
  let disposed = false;

  const apply = el('button', { class: 'primary', onClick: () => {
    if (!hit) return;
    app.pushOp({
      id: newId(),
      type: 'text',
      text: text.value,
      height: height.valueAsNumber,
      depth: depth.valueAsNumber,
      mode: mode.value as Mode,
      origin: hit.point,
      normal: hit.normal,
      rotation: rotation.valueAsNumber,
    });
  } }, ['Apply']);

  host.append(
    row('Text', text),
    row('Height', height),
    row('Depth', depth),
    row('Mode', mode),
    row('Rotation', rotation),
    pickHint,
    fontHint,
    actions(apply),
  );

  function refresh(): void {
    apply.disabled = !hit || !fontReady || !text.value || !app.canEditGeometry;
    if (hit) {
      pickHint.textContent = `At ${hit.point.map(fmt).join(', ')}  normal ${hit.normal.map(fmt).join(', ')}`;
    }
  }

  getFont().then(
    (font) => {
      if (disposed) return;
      app.engine.font = font;
      fontReady = true;
      fontHint.textContent = '';
      fontHint.hidden = true;
      refresh();
    },
    (e: unknown) => {
      if (disposed) return;
      fontHint.textContent = `Font failed to load: ${e instanceof Error ? e.message : String(e)}`;
    },
  );

  app.viewport?.setPickMode(true);
  const unsubscribe = app.viewport?.onFacePick((h) => {
    hit = h;
    refresh();
  });
  text.addEventListener('input', refresh);
  const off = app.onChange(refresh);
  refresh();

  return {
    dispose() {
      disposed = true;
      off();
      unsubscribe?.();
      app.viewport?.setPickMode(false);
    },
  };
}
