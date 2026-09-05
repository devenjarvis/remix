import type { Manifold } from 'manifold-3d';
import type { Font } from 'opentype.js';
import { faceFrame, type Mat4 } from '../mat4';
import { manifold } from '../manifold';
import { withSlot } from '../trimesh';
import { registerOp } from './registry';
import type { TextOp } from './types';

type Pt = [number, number];

const CURVE_SEGMENTS = 8;
const OVERLAP = 0.02;

function quad(p0: Pt, p1: Pt, p2: Pt, out: Pt[]): void {
  for (let i = 1; i <= CURVE_SEGMENTS; i++) {
    const t = i / CURVE_SEGMENTS;
    const u = 1 - t;
    out.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
  }
}

function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, out: Pt[]): void {
  for (let i = 1; i <= CURVE_SEGMENTS; i++) {
    const t = i / CURVE_SEGMENTS;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]);
  }
}

/** Flattened glyph outlines in mm, y up, with the text centered on its bounding box. */
export function textContours(text: string, font: Font, height: number): Pt[][] {
  const path = font.getPath(text, 0, 0, height);
  const contours: Pt[][] = [];
  let cur: Pt[] = [];
  let last: Pt = [0, 0];
  const close = () => {
    if (cur.length > 2) contours.push(cur);
    cur = [];
  };
  for (const c of path.commands) {
    switch (c.type) {
      case 'M':
        close();
        last = [c.x, -c.y];
        cur.push(last);
        break;
      case 'L':
        last = [c.x, -c.y];
        cur.push(last);
        break;
      case 'Q':
        quad(last, [c.x1, -c.y1], [c.x, -c.y], cur);
        last = [c.x, -c.y];
        break;
      case 'C':
        cubic(last, [c.x1, -c.y1], [c.x2, -c.y2], [c.x, -c.y], cur);
        last = [c.x, -c.y];
        break;
      case 'Z':
        close();
        break;
    }
  }
  close();
  for (const contour of contours) {
    const a = contour[0];
    const b = contour[contour.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) contour.pop();
  }
  const bb = path.getBoundingBox();
  const cx = (bb.x1 + bb.x2) / 2;
  const cy = -(bb.y1 + bb.y2) / 2;
  return contours.map((c) => c.map(([x, y]) => [x - cx, y - cy] as Pt));
}

export function textToManifold(text: string, font: Font, height: number, depth: number): Manifold {
  const { CrossSection, Manifold } = manifold();
  const contours = textContours(text, font, height);
  if (!contours.length) throw new Error('Text has no printable glyphs');
  const cs = new CrossSection(contours, 'EvenOdd');
  const m = Manifold.extrude(cs, depth);
  cs.delete();
  return m;
}

function placed(op: TextOp, font: Font): Manifold {
  const raise = op.mode === 'emboss';
  const total = op.depth + OVERLAP;
  const solid = textToManifold(op.text, font, op.height, total);
  const shifted = raise ? solid.translate([0, 0, -OVERLAP]) : solid.translate([0, 0, -op.depth]);
  solid.delete();
  const frame: Mat4 = faceFrame(op.origin, op.normal, op.rotation);
  const out = shifted.transform(frame as Parameters<Manifold['transform']>[0]);
  shifted.delete();
  if (!op.color) return out;
  const tagged = withSlot(out, op.color);
  out.delete();
  return tagged;
}

function overlaps(a: Manifold, b: Manifold): boolean {
  const x = a.boundingBox();
  const y = b.boundingBox();
  for (let k = 0; k < 3; k++) if (x.max[k] < y.min[k] || y.max[k] < x.min[k]) return false;
  return true;
}

registerOp<TextOp>('text', (input, op, ctx) => {
  const font = ctx.font as Font | undefined;
  if (!font) throw new Error('Font not loaded');
  if (!op.text.trim()) throw new Error('Text is empty');
  const tool = placed(op, font);
  if (!input.length) return op.mode === 'emboss' ? [tool] : (tool.delete(), []);
  try {
    let target = input.findIndex((p) => overlaps(p, tool));
    if (target < 0) target = 0;
    return input.map((p, i) => (i !== target ? p : op.mode === 'emboss' ? p.add(tool) : p.subtract(tool)));
  } finally {
    tool.delete();
  }
});
