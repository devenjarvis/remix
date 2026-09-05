import type { AppState } from '../app';
import type { FormHandle } from '../panel';
import type { BooleanOp, ToolBody } from '../../core/ops/types';
import { newId } from '../../core/ops/types';
import type { TriMesh, Vec3 } from '../../core/types';
import { bounds } from '../../core/trimesh';
import { loadModel } from '../../io/load';
import { actions, colorSelect, el, fmt, hint, numberInput, row, select } from '../dom';
import { ToolGizmo, type GizmoMode } from '../gizmo';
import { Viewport } from '../viewport';

type Kind = 'box' | 'cylinder' | 'sphere' | 'mesh';
type Mode = BooleanOp['mode'];

export function buildBooleanForm(host: HTMLElement, app: AppState): FormHandle {
  if (!(app.viewport instanceof Viewport)) {
    host.append(hint('Boolean tools need the 3D viewport'));
    return {};
  }
  const viewport = app.viewport;
  const gizmo = new ToolGizmo(viewport);

  const mode = select<Mode>([['union', 'Union'], ['subtract', 'Subtract'], ['intersect', 'Intersect']], 'subtract');
  const kind = select<Kind>([['box', 'Box'], ['cylinder', 'Cylinder'], ['sphere', 'Sphere'], ['mesh', 'Import file…']], 'box');
  const sx = numberInput(10, { min: 0.01 });
  const sy = numberInput(10, { min: 0.01 });
  const sz = numberInput(10, { min: 0.01 });
  const color = colorSelect(app, 0);
  const sizeRow = row('Size (mm)', sx, sy, sz);
  const file = el('input', { type: 'file', accept: '.stl,.obj,.3mf' });
  const fileInfo = hint('No file loaded');
  const fileRow = el('div', { class: 'row' }, [el('label', {}, ['File']), file]);
  let mesh: { name: string; mesh: TriMesh } | null = null;

  const modeButtons: Record<GizmoMode, HTMLButtonElement> = {
    translate: el('button', { onClick: () => setGizmoMode('translate') }, ['Move (W)']),
    rotate: el('button', { onClick: () => setGizmoMode('rotate') }, ['Rotate (E)']),
    scale: el('button', { onClick: () => setGizmoMode('scale') }, ['Scale (R)']),
  };
  const setGizmoMode = (m: GizmoMode) => {
    gizmo.setMode(m);
    for (const [k, b] of Object.entries(modeButtons)) b.classList.toggle('active', k === m);
  };

  const currentTool = (): ToolBody | null => {
    if (kind.value === 'mesh') {
      return mesh
        ? { kind: 'mesh', name: mesh.name, positions: Array.from(mesh.mesh.positions), indices: Array.from(mesh.mesh.indices) }
        : null;
    }
    const size: Vec3 = [sx.valueAsNumber || 10, sy.valueAsNumber || 10, sz.valueAsNumber || 10];
    return { kind: kind.value as Exclude<Kind, 'mesh'>, size };
  };

  let id = newId();
  const op = (tool: ToolBody): BooleanOp => ({
    id,
    type: 'boolean',
    mode: mode.value as Mode,
    tool,
    matrix: gizmo.getMatrix(),
    ...(Number(color.value) > 0 ? { color: Number(color.value) } : {}),
  });
  const preview = () => {
    const tool = currentTool();
    app.setPreview(tool && app.bounds ? op(tool) : null, 200);
  };
  const apply = el('button', {
    class: 'primary',
    onClick: () => {
      const tool = currentTool();
      if (!tool) return;
      app.pushOp(op(tool));
      id = newId();
    },
  }, ['Apply']);

  const updateTool = () => {
    const isMesh = kind.value === 'mesh';
    sizeRow.hidden = isMesh;
    fileRow.hidden = !isMesh;
    fileInfo.hidden = !isMesh;
    const tool = currentTool();
    if (tool) gizmo.setTool(tool);
    apply.disabled = !tool || !app.bounds;
    preview();
  };

  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      const m = (await loadModel(f.name, await f.arrayBuffer())).mesh;
      mesh = { name: f.name, mesh: m };
      const b = bounds(m);
      fileInfo.textContent = `${f.name}: ${fmt(b.size[0])} × ${fmt(b.size[1])} × ${fmt(b.size[2])} mm`;
    } catch (err) {
      mesh = null;
      fileInfo.textContent = `Failed to load: ${(err as Error).message}`;
    }
    updateTool();
  });
  for (const input of [kind, sx, sy, sz]) input.addEventListener('input', updateTool);
  mode.addEventListener('change', preview);
  color.addEventListener('change', preview);
  const offGizmo = gizmo.onTransform(preview);

  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (!host.contains(t) && !viewport.domElement.matches(':hover')) return;
    const m = ({ w: 'translate', e: 'rotate', r: 'scale' } as Record<string, GizmoMode>)[e.key.toLowerCase()];
    if (m) setGizmoMode(m);
  };
  window.addEventListener('keydown', onKey);

  host.append(
    row('Mode', mode),
    row('Tool', kind),
    sizeRow,
    fileRow,
    fileInfo,
    row('Gizmo', modeButtons.translate, modeButtons.rotate, modeButtons.scale),
    row('Color', color),
    actions(apply),
  );
  host.tabIndex = -1;

  const b = app.bounds;
  gizmo.placeAt(b ? [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2] : [0, 0, 0]);
  setGizmoMode('translate');
  updateTool();

  const unsub = app.onChange(() => (apply.disabled = !currentTool() || !app.bounds));
  return {
    dispose() {
      unsub();
      offGizmo();
      window.removeEventListener('keydown', onKey);
      gizmo.dispose();
      app.setPreview(null);
    },
  };
}
