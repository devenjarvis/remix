import type { AppState, FaceHit } from '../app';
import type { FormHandle } from '../panel';
import type { Panel } from '../panel';
import { newId, type PaintOp, type Selection } from '../../core/ops/types';
import { paintOpFromHit, thinStroke } from '../../core/ops/paint';
import { MAX_SLOTS, type PaletteSlot } from '../../core/color';
import { buildAdjacency, selectBrush, selectFill } from '../../core/select';
import type { TriMesh, Vec3 } from '../../core/types';
import { bounds } from '../../core/trimesh';
import { actions, el, fmt, hint, numberInput, row, select } from '../dom';

type Mode = 'fill' | 'brush' | 'height' | 'part' | 'all';

const SLOT_COLORS = ['#e04b3a', '#3a8fe0', '#4bb84b', '#f0c419', '#9b59b6', '#e67e22', '#1abc9c', '#e84393', '#7f8c8d', '#2ecc71', '#d35400', '#34495e', '#f39c12', '#16a085', '#c0392b', '#8e44ad'];

export function buildPaintForm(host: HTMLElement, app: AppState): FormHandle {
  const viewport = app.viewport;
  let active = Math.min(1, app.palette.length - 1);
  let id = newId();
  const adjacency = new WeakMap<TriMesh, Int32Array>();
  const adjacencyOf = (m: TriMesh): Int32Array => {
    let adj = adjacency.get(m);
    if (!adj) {
      adj = buildAdjacency(m);
      adjacency.set(m, adj);
    }
    return adj;
  };

  const swatches = el('div', { class: 'swatches' });
  const name = el('input', { type: 'text' });
  const hex = el('input', { type: 'color' });
  const addBtn = el('button', { onClick: () => editPalette([...app.palette, { name: `Color ${app.palette.length}`, hex: SLOT_COLORS[(app.palette.length - 1) % SLOT_COLORS.length] }], app.palette.length) }, ['Add']);
  const removeBtn = el('button', { onClick: () => editPalette(app.palette.slice(0, -1), Math.min(active, app.palette.length - 2)) }, ['Remove']);
  const mode = select<Mode>([['fill', 'Fill'], ['brush', 'Brush'], ['height', 'Height'], ['part', 'Part'], ['all', 'All']], 'fill');
  const angle = el('input', { type: 'range', min: 0, max: 180, step: 1 });
  angle.value = '30';
  const angleValue = numberInput(30, { step: 1, min: 0 });
  const radius = numberInput(3, { step: 0.5, min: 0.1 });
  const minZ = numberInput(0);
  const maxZ = numberInput(0);
  const partList = el('div', { class: 'parts' });
  const info = hint();
  const apply = el('button', { class: 'primary', onClick: () => applyPreview() }, ['Apply']);

  const rows: Record<string, HTMLElement> = {
    fill: row('Angle', angle, angleValue),
    brush: row('Radius', radius),
    height: row('Z range', minZ, maxZ),
    part: partList,
  };

  host.append(
    swatches,
    row('Name', name, hex),
    row('', addBtn, removeBtn),
    row('Mode', mode),
    rows.fill,
    rows.brush,
    rows.height,
    rows.part,
    info,
    actions(apply),
  );

  function editPalette(palette: PaletteSlot[], nextActive: number): void {
    active = Math.max(0, Math.min(nextActive, palette.length - 1));
    app.setPalette(palette);
  }

  function renderSwatches(): void {
    swatches.replaceChildren(
      ...app.palette.map((s, i) => {
        const b = el('button', { class: `swatch${i === active ? ' active' : ''}`, title: i === 0 ? 'Base' : `${s.name} (key ${i})` }, [
          el('span', { class: 'chip', style: `background:${s.hex}` }),
          i === 0 ? 'Base' : String(i),
        ]);
        b.addEventListener('click', () => setActive(i));
        return b;
      }),
    );
    const slot = app.palette[active];
    name.value = slot?.name ?? '';
    hex.value = slot?.hex ?? '#000000';
    addBtn.disabled = app.palette.length >= MAX_SLOTS + 1;
    removeBtn.disabled = app.palette.length <= 1;
  }

  function setActive(i: number): void {
    active = i;
    renderSwatches();
    preview();
  }

  const selection = (): Selection | null => {
    switch (mode.value as Mode) {
      case 'height':
        return { kind: 'height', min: minZ.valueAsNumber, max: maxZ.valueAsNumber };
      case 'part': {
        const picked = partList.querySelector<HTMLInputElement>('input:checked');
        return picked ? { kind: 'part', index: Number(picked.value) } : null;
      }
      case 'all':
        return { kind: 'all' };
      default:
        return null;
    }
  };
  const op = (sel: Selection): PaintOp => ({ id, type: 'paint', color: active, select: sel });

  function preview(): void {
    const sel = selection();
    if (!sel || !app.bounds) {
      app.setPreview(null);
      return;
    }
    app.setPreview(op(sel), 150);
  }

  function applyPreview(): void {
    const sel = selection();
    if (!sel) return;
    app.pushOp(op(sel));
    id = newId();
  }

  function renderParts(): void {
    if (mode.value !== 'part') return;
    const parts = app.parts;
    if (partList.children.length === parts.length) return;
    partList.replaceChildren(
      ...parts.map((p, i) => {
        const radio = el('input', { type: 'radio', name: 'paint-part', value: String(i), checked: i === 0 });
        return el('label', { class: 'row' }, [radio, `Part ${i + 1} — ${p.indices.length / 3} tris, ${bounds(p).size.map(fmt).join('×')} mm`]);
      }),
    );
  }

  function seedHeight(): void {
    const b = app.bounds;
    if (!b) return;
    minZ.value = fmt(b.min[2]);
    maxZ.value = fmt((b.min[2] + b.max[2]) / 2);
  }

  let hoverPart = -1;
  function clearHighlight(): void {
    if (hoverPart >= 0) viewport?.highlightTriangles(hoverPart, null);
    hoverPart = -1;
  }

  function onHover(hit: FaceHit | null): void {
    if (mode.value !== 'fill') return;
    if (!hit || hit.partIndex !== hoverPart) clearHighlight();
    if (!hit) return;
    const mesh = app.parts[hit.partIndex];
    if (!mesh) return;
    hoverPart = hit.partIndex;
    viewport?.highlightTriangles(hit.partIndex, selectFill(mesh, adjacencyOf(mesh), hit.triangle, angle.valueAsNumber));
  }

  function onPick(hit: FaceHit): void {
    if (mode.value !== 'fill' || !app.canEditGeometry) return;
    clearHighlight();
    app.pushOp(paintOpFromHit(hit, active, angle.valueAsNumber, id));
    id = newId();
  }

  let stroke: { part: number; points: Vec3[]; normals: Vec3[]; overlay: Uint8Array } | null = null;
  function onDrag(hit: FaceHit, phase: 'start' | 'move' | 'end'): void {
    if (mode.value !== 'brush' || !app.canEditGeometry) return;
    if (phase === 'start') {
      const mesh = app.parts[hit.partIndex];
      if (!mesh) return;
      stroke = { part: hit.partIndex, points: [], normals: [], overlay: mesh.colors ? mesh.colors.slice() : new Uint8Array(mesh.indices.length / 3) };
    }
    if (!stroke) return;
    const r = radius.valueAsNumber || 3;
    if (hit.partIndex === stroke.part) {
      const last = stroke.points[stroke.points.length - 1];
      const far = !last || Math.hypot(hit.point[0] - last[0], hit.point[1] - last[1], hit.point[2] - last[2]) >= r / 4;
      if (far) {
        stroke.points.push(hit.point);
        stroke.normals.push(hit.normal);
        const mesh = app.parts[stroke.part];
        for (const t of selectBrush(mesh, adjacencyOf(mesh), [hit.triangle], [hit.point], r)) stroke.overlay[t] = active;
        viewport?.setTriangleColors(stroke.part, stroke.overlay);
      }
    }
    if (phase !== 'end') return;
    const { part, points, normals } = stroke;
    stroke = null;
    viewport?.setTriangleColors(part, null);
    if (!points.length) return;
    const thinned = thinStroke(points, normals, r / 4);
    app.pushOp({ id, type: 'paint', color: active, select: { kind: 'brush', part, points: thinned.points, normals: thinned.normals, radius: r } });
    id = newId();
  }

  function updateMode(): void {
    const m = mode.value as Mode;
    for (const [k, r] of Object.entries(rows)) r.hidden = k !== m;
    apply.hidden = m === 'fill' || m === 'brush';
    viewport?.setPickMode(m === 'fill' || m === 'brush');
    clearHighlight();
    info.textContent = {
      fill: 'Hover to preview a connected region, click to paint it',
      brush: 'Drag on the model to paint',
      height: 'Paints every triangle whose center lies in the Z range',
      part: 'Paints one whole part',
      all: 'Paints every part',
    }[m];
    if (m === 'height') seedHeight();
    renderParts();
    preview();
  }

  function refresh(): void {
    renderSwatches();
    renderParts();
    apply.disabled = !app.canEditGeometry || !selection();
  }

  const onKey = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    const n = Number(e.key);
    if (!Number.isInteger(n) || n < 1 || n > 9 || n >= app.palette.length) return;
    setActive(n);
  };

  name.addEventListener('input', () => {
    const palette = app.palette.map((s, i) => (i === active ? { ...s, name: name.value } : s));
    app.setPalette(palette);
  });
  hex.addEventListener('input', () => {
    const palette = app.palette.map((s, i) => (i === active ? { ...s, hex: hex.value } : s));
    app.setPalette(palette);
  });
  angle.addEventListener('input', () => (angleValue.value = angle.value));
  angleValue.addEventListener('input', () => (angle.value = angleValue.value));
  mode.addEventListener('change', updateMode);
  for (const input of [minZ, maxZ]) input.addEventListener('input', preview);
  partList.addEventListener('change', preview);
  window.addEventListener('keydown', onKey);

  const offChange = app.onChange(refresh);
  const offHover = viewport?.onHover(onHover);
  const offPick = viewport?.onFacePick(onPick);
  const offDrag = viewport?.onDrag(onDrag);
  refresh();
  updateMode();

  return {
    dispose() {
      offChange();
      offHover?.();
      offPick?.();
      offDrag?.();
      window.removeEventListener('keydown', onKey);
      clearHighlight();
      if (stroke) viewport?.setTriangleColors(stroke.part, null);
      viewport?.setPickMode(false);
      app.setPreview(null);
    },
  };
}

export function registerPaintForm(panel: Panel): void {
  panel.register('paint', 'Paint', buildPaintForm, { needsManifold: true });
}
