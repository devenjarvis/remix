import type { AppState, FaceHit } from '../app';
import type { FormHandle } from '../panel';
import type { Panel } from '../panel';
import { newId, type PaintOp, type Selection } from '../../core/ops/types';
import { paintOpFromHit, thinStroke } from '../../core/ops/paint';
import { MAX_SLOTS, type PaletteSlot } from '../../core/color';
import { adjacencyOf, selectBrush, selectFill, type FillRule } from '../../core/select';
import type { Vec3 } from '../../core/types';
import { bounds } from '../../core/trimesh';
import { actions, el, fmt, hint, numberInput, row, select } from '../dom';

type Mode = 'fill' | 'brush' | 'height' | 'part' | 'all';

const SLOT_COLORS = ['#e04b3a', '#3a8fe0', '#4bb84b', '#f0c419', '#9b59b6', '#e67e22', '#1abc9c', '#e84393', '#7f8c8d', '#2ecc71', '#d35400', '#34495e', '#f39c12', '#16a085', '#c0392b', '#8e44ad'];

export function buildPaintForm(host: HTMLElement, app: AppState): FormHandle {
  const viewport = app.viewport;
  let active = Math.min(1, app.palette.length - 1);
  let id = newId();

  const swatches = el('div', { class: 'swatches' });
  const name = el('input', { type: 'text' });
  const hex = el('input', { type: 'color' });
  const addBtn = el('button', { onClick: () => editPalette([...app.palette, { name: `Color ${app.palette.length}`, hex: SLOT_COLORS[(app.palette.length - 1) % SLOT_COLORS.length] }], app.palette.length) }, ['Add']);
  const removeBtn = el('button', { onClick: () => editPalette(app.palette.slice(0, -1), Math.min(active, app.palette.length - 2)) }, ['Remove']);
  const mode = select<Mode>([['fill', 'Fill'], ['brush', 'Brush'], ['height', 'Height'], ['part', 'Part'], ['all', 'All']], 'fill');
  const rule = select<FillRule>([['crease', 'Stop at creases'], ['seed', 'Similar direction']], 'crease');
  const angle = el('input', { type: 'range', min: 0, max: 180, step: 1 });
  angle.value = '30';
  const angleValue = numberInput(30, { step: 1, min: 0 });
  const radius = numberInput(3, { step: 0.5, min: 0.1 });
  const minZ = numberInput(0);
  const maxZ = numberInput(0);
  const partList = el('div', { class: 'parts' });
  const info = hint();
  const apply = el('button', { class: 'primary', onClick: () => applyPreview() }, ['Apply']);

  const fillRows = el('div', { class: 'stack' }, [row('Rule', rule), row('Angle', angle, angleValue)]);
  const rows: Record<string, HTMLElement> = {
    fill: fillRows,
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
    const last = app.palette.length - 1;
    const lastInUse = app.parts.some((p) => p.colors?.some((c) => c === last));
    removeBtn.disabled = last < 1 || lastInUse;
    removeBtn.title = lastInUse ? `Slot ${last} is painted on the model` : '';
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
    if (mode.value === 'fill') {
      if (pinned) paintFill(pinned.hit);
      return;
    }
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
  let pinned: { hit: FaceHit; indices: Uint32Array } | null = null;
  function clearHighlight(): void {
    if (hoverPart >= 0) viewport?.highlightTriangles(hoverPart, null);
    hoverPart = -1;
  }
  function unpin(): void {
    pinned = null;
    clearHighlight();
    apply.disabled = !app.canEditGeometry || (mode.value === 'fill' ? true : !selection());
  }

  /** Re-highlights the pinned fill region; the pin stays until the geometry changes or a paint is applied. */
  function showFill(): void {
    if (mode.value !== 'fill' || !pinned) return;
    const { hit } = pinned;
    const mesh = app.parts[hit.partIndex];
    if (!mesh || mesh.indices !== pinned.indices) return unpin();
    if (hoverPart >= 0 && hoverPart !== hit.partIndex) viewport?.highlightTriangles(hoverPart, null);
    hoverPart = hit.partIndex;
    viewport?.highlightTriangles(hoverPart, selectFill(mesh, adjacencyOf(mesh), hit.triangle, angle.valueAsNumber, rule.value as FillRule));
    apply.disabled = !app.canEditGeometry;
  }

  function onHover(hit: FaceHit | null): void {
    if (mode.value !== 'fill' || !hit) return;
    const mesh = app.parts[hit.partIndex];
    if (!mesh) return;
    pinned = { hit, indices: mesh.indices };
    showFill();
  }

  function paintFill(hit: FaceHit): void {
    if (!app.canEditGeometry) return;
    unpin();
    app.pushOp(paintOpFromHit(hit, active, angle.valueAsNumber, id, rule.value as FillRule));
    id = newId();
  }

  function onPick(hit: FaceHit): void {
    if (mode.value === 'fill') paintFill(hit);
  }

  function setAngle(value: number): void {
    const next = Math.max(0, Math.min(180, Math.round(value)));
    angle.value = angleValue.value = String(next);
    showFill();
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

  let offDrag: (() => void) | undefined;
  function updateMode(): void {
    const m = mode.value as Mode;
    offDrag?.();
    offDrag = m === 'brush' ? viewport?.onDrag(onDrag) : undefined;
    for (const [k, r] of Object.entries(rows)) r.hidden = k !== m;
    apply.hidden = m === 'brush';
    apply.textContent = m === 'fill' ? 'Paint highlighted' : 'Apply';
    viewport?.setPickMode(m === 'fill' || m === 'brush');
    unpin();
    info.textContent = {
      fill: 'Hover to preview a region and click to paint it. Stop at creases follows smooth curves and stops at sharp edges; Similar direction keeps to faces near the hovered normal. The preview stays while you adjust the angle; [ and ] nudge it by 5°.',
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
    apply.disabled = !app.canEditGeometry || (mode.value === 'fill' ? !pinned : !selection());
    showFill();
  }

  const onKey = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (e.key === '[' || e.key === ']') return setAngle(angle.valueAsNumber + (e.key === ']' ? 5 : -5));
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
  angle.addEventListener('input', () => setAngle(angle.valueAsNumber));
  angleValue.addEventListener('input', () => setAngle(angleValue.valueAsNumber));
  mode.addEventListener('change', updateMode);
  rule.addEventListener('change', showFill);
  for (const input of [minZ, maxZ]) input.addEventListener('input', preview);
  partList.addEventListener('change', preview);
  window.addEventListener('keydown', onKey);

  const offChange = app.onChange(refresh);
  const offHover = viewport?.onHover(onHover);
  const offPick = viewport?.onFacePick(onPick);
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
