import type { AppState, FaceHit } from '../app';
import type { FormHandle } from '../panel';
import type { Panel } from '../panel';
import { newId, type GestureMode, type PaintOp, type Selection } from '../../core/ops/types';
import { thinStroke } from '../../core/ops/paint';
import { MAX_SLOTS, type PaletteSlot } from '../../core/color';
import { adjacencyOf, selectBrush, selectFill, type FillRule } from '../../core/select';
import { segmentMesh, selectSegment } from '../../core/segment';
import { selectLasso } from '../../core/lasso';
import type { TriMesh, Vec3 } from '../../core/types';
import { bounds } from '../../core/trimesh';
import { actions, el, fmt, hint, numberInput, row, select } from '../dom';
import { LiveSelection } from '../selection';

type Tool = 'segment' | 'fill' | 'brush' | 'lasso' | 'height' | 'part' | 'all';
type Edges = NonNullable<PaintOp['edges']>;

const SLOT_COLORS = ['#e04b3a', '#3a8fe0', '#4bb84b', '#f0c419', '#9b59b6', '#e67e22', '#1abc9c', '#e84393', '#7f8c8d', '#2ecc71', '#d35400', '#34495e', '#f39c12', '#16a085', '#c0392b', '#8e44ad'];

const HINTS: Record<Tool, string> = {
  segment: 'Hover to see the surface region within the tolerance of one mean direction; click to add it. Alt-click subtracts. Enter paints the selection.',
  fill: 'Hover to see the region within the angle of the hovered face; click to add it. Similar direction compares with the hovered face; Stop at creases follows smooth curves. Dam keeps the fill out of painted triangles.',
  brush: 'Drag on the model to add a stroke to the selection. Dam keeps the stroke out of painted triangles.',
  lasso: 'Drag a loop on the viewport. Visible triangles inside the loop join the selection; Smooth edges cut along the loop.',
  height: 'Adds everything in the Z range. Smooth edges cut on the planes.',
  part: 'Adds one whole part.',
  all: 'Adds every part.',
};

function indicesOf(set: Uint8Array): Uint32Array {
  let count = 0;
  for (let i = 0; i < set.length; i++) if (set[i]) count++;
  const out = new Uint32Array(count);
  let j = 0;
  for (let i = 0; i < set.length; i++) if (set[i]) out[j++] = i;
  return out;
}

function blockedBy(mesh: TriMesh): Uint8Array | undefined {
  if (!mesh.colors) return undefined;
  const out = new Uint8Array(mesh.colors.length);
  for (let t = 0; t < out.length; t++) if (mesh.colors[t]) out[t] = 1;
  return out;
}

export function buildPaintForm(host: HTMLElement, app: AppState): FormHandle {
  const viewport = app.viewport;
  const live = new LiveSelection();
  let active = Math.min(1, app.palette.length - 1);
  let id = newId();
  let altHeld = false;

  const swatches = el('div', { class: 'swatches' });
  const name = el('input', { type: 'text' });
  const hex = el('input', { type: 'color' });
  const addBtn = el('button', { onClick: () => editPalette([...app.palette, { name: `Color ${app.palette.length}`, hex: SLOT_COLORS[(app.palette.length - 1) % SLOT_COLORS.length] }], app.palette.length) }, ['Add']);
  const removeBtn = el('button', { onClick: () => editPalette(app.palette.slice(0, -1), Math.min(active, app.palette.length - 2)) }, ['Remove']);
  const tool = select<Tool>([['segment', 'Segment'], ['fill', 'Fill'], ['brush', 'Brush'], ['lasso', 'Lasso'], ['height', 'Height'], ['part', 'Part'], ['all', 'All']], 'segment');
  const addMode = el('button', { class: 'active', onClick: () => setMode('add') }, ['Add']);
  const subtractMode = el('button', { onClick: () => setMode('subtract') }, ['Subtract']);
  let chosenMode: GestureMode = 'add';
  const rule = select<FillRule>([['seed', 'Similar direction'], ['crease', 'Stop at creases']], 'seed');
  const edges = select<Edges>([['smooth', 'Smooth'], ['triangles', 'Triangles']], 'smooth');
  const angle = el('input', { type: 'range', min: 0, max: 180, step: 1 });
  angle.value = '30';
  const angleValue = numberInput(30, { step: 1, min: 0 });
  const angleLabel = el('label', {}, ['Tolerance']);
  const dam = el('input', { type: 'checkbox' });
  const radius = numberInput(3, { step: 0.5, min: 0.1 });
  const minZ = numberInput(0);
  const maxZ = numberInput(0);
  const partList = el('div', { class: 'parts' });
  const addRegion = el('button', { onClick: () => addFromForm() }, ['Add to selection']);
  const growDistance = numberInput(1, { step: 0.5, min: 0.1 });
  const invertBtn = el('button', { onClick: () => addGesture({ kind: 'invert' }) }, ['Invert']);
  const growBtn = el('button', { onClick: () => addGesture({ kind: 'grow', distance: growDistance.valueAsNumber || 1 }) }, ['Grow']);
  const shrinkBtn = el('button', { onClick: () => addGesture({ kind: 'shrink', distance: growDistance.valueAsNumber || 1 }) }, ['Shrink']);
  const undoBtn = el('button', { onClick: () => undoGesture() }, ['Undo gesture']);
  const clearBtn = el('button', { onClick: () => clearSelection() }, ['Clear']);
  const paintBtn = el('button', { class: 'primary', onClick: () => paintSelection() }, ['Paint selection']);
  const info = hint();
  const summary = hint();

  const angleRow = el('div', { class: 'row' }, [angleLabel, angle, angleValue]);
  const ruleRow = row('Rule', rule);
  const damRow = row('Dam', dam);
  const edgesRow = row('Edges', edges);
  const rows: Record<string, HTMLElement> = {
    segment: angleRow,
    rule: ruleRow,
    dam: damRow,
    brush: row('Radius', radius),
    height: row('Z range', minZ, maxZ),
    part: partList,
    region: actions(addRegion),
  };

  host.append(
    swatches,
    row('Name', name, hex),
    row('', addBtn, removeBtn),
    row('Tool', tool),
    row('Mode', addMode, subtractMode),
    rows.rule,
    rows.segment,
    rows.dam,
    rows.brush,
    rows.height,
    rows.part,
    rows.region,
    info,
    row('Distance', growDistance),
    actions(invertBtn, growBtn, shrinkBtn),
    actions(undoBtn, clearBtn),
    edgesRow,
    summary,
    actions(paintBtn),
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
  }

  const mode = (): GestureMode => (altHeld ? (chosenMode === 'add' ? 'subtract' : 'add') : chosenMode);
  const withMode = <T extends Selection>(sel: T): T => (mode() === 'subtract' ? { ...sel, mode: 'subtract' } : sel);
  const withDam = <T extends Selection>(sel: T): T => (dam.checked ? { ...sel, dam: true } : sel);

  function setMode(m: GestureMode): void {
    chosenMode = m;
    renderMode();
  }

  function renderMode(): void {
    const m = mode();
    addMode.classList.toggle('active', m === 'add');
    subtractMode.classList.toggle('active', m === 'subtract');
    addRegion.textContent = m === 'add' ? 'Add to selection' : 'Subtract from selection';
    showHover();
  }

  let highlighted = new Set<number>();
  /** Shows every part's set, with the hovered region merged into its part. */
  function highlight(hover?: { part: number; region: Uint32Array }): void {
    const parts = app.parts;
    const sets = live.sets(parts);
    const shown = new Set<number>();
    parts.forEach((_, i) => {
      let set = sets[i];
      if (hover && hover.part === i) {
        set = set.slice();
        const value = mode() === 'subtract' ? 0 : 1;
        for (const t of hover.region) set[t] = value;
      }
      const tris = indicesOf(set);
      if (!tris.length) return;
      viewport?.highlightTriangles(i, tris);
      shown.add(i);
    });
    for (const i of highlighted) if (!shown.has(i)) viewport?.highlightTriangles(i, null);
    highlighted = shown;
  }

  function clearHighlight(): void {
    for (const i of highlighted) viewport?.highlightTriangles(i, null);
    highlighted = new Set();
  }

  function renderSummary(): void {
    const n = live.gestures.length;
    summary.textContent = n ? `${n} gesture${n > 1 ? 's' : ''} selected. Enter paints, Backspace undoes the last gesture, Escape clears.` : 'Nothing selected yet.';
    const can = app.canEditGeometry && n > 0;
    paintBtn.disabled = !can;
    undoBtn.disabled = n === 0;
    clearBtn.disabled = n === 0;
    invertBtn.disabled = !app.canEditGeometry;
    growBtn.disabled = shrinkBtn.disabled = n === 0;
  }

  function addGesture(sel: Selection): void {
    if (!app.canEditGeometry) return;
    live.add(sel, app.parts);
    renderSummary();
    highlight();
  }

  function undoGesture(): void {
    if (live.isEmpty) return;
    live.undo();
    renderSummary();
    highlight();
  }

  function clearSelection(): void {
    live.clear();
    renderSummary();
    highlight();
  }

  function paintSelection(): void {
    if (!app.canEditGeometry || live.isEmpty) return;
    const gestures = live.gestures;
    const sel: Selection = gestures.length === 1 ? gestures[0] : { kind: 'multi', selections: gestures };
    live.clear();
    clearHighlight();
    app.pushOp({ id, type: 'paint', color: active, edges: edges.value as Edges, select: sel });
    id = newId();
    renderSummary();
  }

  function addFromForm(): void {
    switch (tool.value as Tool) {
      case 'height':
        return addGesture(withMode({ kind: 'height', min: minZ.valueAsNumber, max: maxZ.valueAsNumber }));
      case 'part': {
        const picked = partList.querySelector<HTMLInputElement>('input:checked');
        if (picked) addGesture(withMode({ kind: 'part', index: Number(picked.value) }));
        return;
      }
      case 'all':
        return addGesture(withMode({ kind: 'all' }));
    }
  }

  function renderParts(): void {
    if (tool.value !== 'part') return;
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

  let hover: { hit: FaceHit; indices: Uint32Array } | null = null;

  function hoverRegion(): { part: number; region: Uint32Array } | null {
    const t = tool.value as Tool;
    if (!hover || (t !== 'segment' && t !== 'fill')) return null;
    const { hit } = hover;
    const mesh = app.parts[hit.partIndex];
    if (!mesh || mesh.indices !== hover.indices) return null;
    const region =
      t === 'segment'
        ? selectSegment(mesh, segmentMesh(mesh, angle.valueAsNumber), hit.triangle)
        : selectFill(mesh, adjacencyOf(mesh), hit.triangle, angle.valueAsNumber, rule.value as FillRule, dam.checked ? blockedBy(mesh) : undefined);
    return { part: hit.partIndex, region };
  }

  function showHover(): void {
    highlight(hoverRegion() ?? undefined);
  }

  function onHover(hit: FaceHit | null): void {
    const t = tool.value as Tool;
    if (t !== 'segment' && t !== 'fill') return;
    if (!hit) {
      hover = null;
      highlight();
      return;
    }
    const mesh = app.parts[hit.partIndex];
    if (!mesh) return;
    hover = { hit, indices: mesh.indices };
    showHover();
  }

  function onPick(hit: FaceHit): void {
    const t = tool.value as Tool;
    if (t === 'segment') addGesture(withMode({ kind: 'segment', part: hit.partIndex, point: hit.point, normal: hit.normal, tolerance: angle.valueAsNumber }));
    else if (t === 'fill') addGesture(withDam(withMode({ kind: 'fill', part: hit.partIndex, point: hit.point, normal: hit.normal, angle: angle.valueAsNumber, rule: rule.value as FillRule })));
  }

  function setAngle(value: number): void {
    const next = Math.max(0, Math.min(180, Math.round(value)));
    angle.value = angleValue.value = String(next);
    showHover();
  }

  let stroke: { part: number; points: Vec3[]; normals: Vec3[]; set: Uint8Array } | null = null;
  function onDrag(hit: FaceHit, phase: 'start' | 'move' | 'end'): void {
    if (tool.value !== 'brush' || !app.canEditGeometry) return;
    if (phase === 'start') {
      const mesh = app.parts[hit.partIndex];
      if (!mesh) return;
      stroke = { part: hit.partIndex, points: [], normals: [], set: live.sets(app.parts)[hit.partIndex].slice() };
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
        const value = mode() === 'subtract' ? 0 : 1;
        for (const t of selectBrush(mesh, adjacencyOf(mesh), [hit.triangle], [hit.point], r, dam.checked ? blockedBy(mesh) : undefined)) stroke.set[t] = value;
        viewport?.highlightTriangles(stroke.part, indicesOf(stroke.set));
        highlighted.add(stroke.part);
      }
    }
    if (phase !== 'end') return;
    const { part, points, normals } = stroke;
    stroke = null;
    if (!points.length) return highlight();
    const thinned = thinStroke(points, normals, r / 4);
    addGesture(withDam(withMode({ kind: 'brush', part, points: thinned.points, normals: thinned.normals, radius: r })));
  }

  function onSketch(points: [number, number][], phase: 'start' | 'move' | 'end'): void {
    if (tool.value !== 'lasso' || phase !== 'end' || points.length < 3 || !viewport || !app.canEditGeometry) return;
    const { eye, polygon } = viewport.sketchToWorld(points);
    app.parts.forEach((mesh, part) => {
      if (selectLasso(mesh, eye, polygon).length) addGesture(withMode({ kind: 'lasso', part, eye, polygon }));
    });
  }

  let offDrag: (() => void) | undefined;
  let offSketch: (() => void) | undefined;
  function updateTool(): void {
    const t = tool.value as Tool;
    offDrag?.();
    offSketch?.();
    offDrag = t === 'brush' ? viewport?.onDrag(onDrag) : undefined;
    offSketch = t === 'lasso' ? viewport?.onSketch(onSketch) : undefined;
    rows.segment.hidden = t !== 'segment' && t !== 'fill';
    rows.rule.hidden = t !== 'fill';
    rows.dam.hidden = t !== 'fill' && t !== 'brush';
    rows.brush.hidden = t !== 'brush';
    rows.height.hidden = t !== 'height';
    rows.part.hidden = t !== 'part';
    rows.region.hidden = t !== 'height' && t !== 'part' && t !== 'all';
    angleLabel.textContent = t === 'segment' ? 'Tolerance' : 'Angle';
    viewport?.setPickMode(t === 'segment' || t === 'fill' || t === 'brush' || t === 'lasso');
    hover = null;
    info.textContent = HINTS[t];
    if (t === 'height') seedHeight();
    renderParts();
    highlight();
  }

  function refresh(): void {
    renderSwatches();
    renderParts();
    renderSummary();
    showHover();
  }

  const inInput = (e: KeyboardEvent): boolean => {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Alt' && !altHeld) {
      altHeld = true;
      renderMode();
      return;
    }
    if (inInput(e)) return;
    if (e.key === 'Enter') {
      if ((e.target as HTMLElement | null)?.tagName !== 'BUTTON') paintSelection();
      return;
    }
    if (e.key === 'Escape') return clearSelection();
    if (e.key === 'Backspace') {
      e.preventDefault();
      return undoGesture();
    }
    if (e.key === '[' || e.key === ']') return setAngle(angle.valueAsNumber + (e.key === ']' ? 1 : -1));
    const n = Number(e.key);
    if (!Number.isInteger(n) || n < 1 || n > 9 || n >= app.palette.length) return;
    setActive(n);
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    if (e.key !== 'Alt' || !altHeld) return;
    altHeld = false;
    renderMode();
  };
  const onBlur = (): void => {
    if (!altHeld) return;
    altHeld = false;
    renderMode();
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
  tool.addEventListener('change', updateTool);
  rule.addEventListener('change', showHover);
  dam.addEventListener('change', showHover);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  const offChange = app.onChange(refresh);
  const offHover = viewport?.onHover(onHover);
  const offPick = viewport?.onFacePick(onPick);
  refresh();
  updateTool();

  return {
    dispose() {
      offChange();
      offHover?.();
      offPick?.();
      offDrag?.();
      offSketch?.();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      clearHighlight();
      viewport?.setPickMode(false);
    },
  };
}

export function registerPaintForm(panel: Panel): void {
  panel.register('paint', 'Paint', buildPaintForm, { needsManifold: true });
}
