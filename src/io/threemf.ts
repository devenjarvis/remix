import { strFromU8, unzipSync } from 'fflate';
import { defaultPalette, MAX_SLOTS, type PaletteSlot } from '../core/color';
import type { TriMesh } from '../core/types';
import { mergeMeshes, weld } from '../core/trimesh';
import { decodePaintColor, parseColorTable } from './color3mf';
import type { Loaded } from './load';

const UNIT_TO_MM: Record<string, number> = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1000,
};

type Mat = number[];
const IDENTITY: Mat = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

/** Per-triangle color reference: `state` is the decoded paint attribute (null = split, undefined = absent); `hex` the pid/p1 color. */
interface Ref {
  state?: number | null;
  hex?: string;
  group?: string;
}

interface Obj {
  mesh?: TriMesh;
  refs: Ref[];
  components: { id: string; transform: Mat }[];
}

type ColorTable = Map<string, string[]>;

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
}

function parseTransform(s: string | undefined): Mat {
  if (!s) return IDENTITY;
  const m = s.trim().split(/\s+/).map(Number);
  return m.length === 12 && m.every(Number.isFinite) ? m : IDENTITY;
}

function mul(a: Mat, b: Mat): Mat {
  const r = new Array<number>(12);
  for (let c = 0; c < 3; c++) {
    for (let k = 0; k < 3; k++) {
      r[c * 3 + k] = b[c * 3] * a[k] + b[c * 3 + 1] * a[3 + k] + b[c * 3 + 2] * a[6 + k];
    }
  }
  for (let k = 0; k < 3; k++) r[9 + k] = b[9] * a[k] + b[10] * a[3 + k] + b[11] * a[6 + k] + a[9 + k];
  return r;
}

function apply(m: TriMesh, t: Mat, scale: number): TriMesh {
  const p = m.positions;
  const positions = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    positions[i] = (x * t[0] + y * t[3] + z * t[6] + t[9]) * scale;
    positions[i + 1] = (x * t[1] + y * t[4] + z * t[7] + t[10]) * scale;
    positions[i + 2] = (x * t[2] + y * t[5] + z * t[8] + t[11]) * scale;
  }
  return { ...m, positions };
}

function parseMesh(xml: string, table: ColorTable, objPid: string | undefined): { mesh: TriMesh; refs: Ref[] } {
  const positions: number[] = [];
  const indices: number[] = [];
  const refs: Ref[] = [];
  for (const m of xml.matchAll(/<vertex\b[^>]*>/g)) {
    positions.push(Number(attr(m[0], 'x')), Number(attr(m[0], 'y')), Number(attr(m[0], 'z')));
  }
  for (const m of xml.matchAll(/<triangle\b[^>]*>/g)) {
    const tag = m[0];
    indices.push(Number(attr(tag, 'v1')), Number(attr(tag, 'v2')), Number(attr(tag, 'v3')));
    const ref: Ref = {};
    const paint = attr(tag, 'paint_color') ?? attr(tag, 'slic3rpe:mmu_segmentation');
    if (paint !== undefined) ref.state = decodePaintColor(paint);
    const p1 = attr(tag, 'p1');
    const pid = attr(tag, 'pid') ?? objPid;
    if (p1 !== undefined && pid !== undefined) {
      ref.hex = table.get(pid)?.[Number(p1)];
      ref.group = pid;
    }
    refs.push(ref);
  }
  return { mesh: { positions: new Float32Array(positions), indices: new Uint32Array(indices) }, refs };
}

function parseObjects(xml: string, table: ColorTable): Map<string, Obj> {
  const objects = new Map<string, Obj>();
  for (const m of xml.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)) {
    const id = attr(m[1], 'id');
    if (!id) continue;
    const body = m[2];
    const obj: Obj = { refs: [], components: [] };
    const mesh = /<mesh\b[^>]*>([\s\S]*?)<\/mesh>/.exec(body);
    if (mesh) {
      const parsed = parseMesh(mesh[1], table, attr(m[1], 'pid'));
      obj.mesh = parsed.mesh;
      obj.refs = parsed.refs;
    }
    for (const c of body.matchAll(/<component\b[^>]*>/g)) {
      const cid = attr(c[0], 'objectid');
      if (cid) obj.components.push({ id: cid, transform: parseTransform(attr(c[0], 'transform')) });
    }
    objects.set(id, obj);
  }
  return objects;
}

function collect(
  objects: Map<string, Obj>,
  id: string,
  t: Mat,
  scale: number,
  out: TriMesh[],
  refs: Ref[],
  depth = 0,
): void {
  const obj = objects.get(id);
  if (!obj || depth > 32) return;
  if (obj.mesh) {
    out.push(apply(obj.mesh, t, scale));
    refs.push(...obj.refs);
  }
  for (const c of obj.components) collect(objects, c.id, mul(t, c.transform), scale, out, refs, depth + 1);
}

function findModelPath(files: Record<string, Uint8Array>): string {
  const rels = files['_rels/.rels'];
  if (rels) {
    for (const m of strFromU8(rels).matchAll(/<Relationship\b[^>]*>/g)) {
      if (attr(m[0], 'Type')?.endsWith('/3dmodel')) {
        const target = attr(m[0], 'Target');
        if (target) {
          const path = target.replace(/^\//, '');
          if (files[path]) return path;
        }
      }
    }
  }
  const any = Object.keys(files).find((k) => k.endsWith('.model'));
  if (!any) throw new Error('3MF has no 3D model part');
  return any;
}

function generatedHex(i: number): string {
  const h = (i * 137.508) % 360;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = 0.5 - 0.325 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function assignSlots(
  refs: Ref[],
  table: ColorTable,
  warnings: string[],
): { colors?: Uint8Array; palette?: PaletteSlot[] } {
  const slotHex: (string | undefined)[] = new Array(MAX_SLOTS + 1);
  const hexSlot = new Map<string, number>();
  const bind = (slot: number, hex: string) => {
    slotHex[slot] = hex;
    hexSlot.set(hex, slot);
  };
  for (const r of refs) {
    if (r.state && r.state > 0 && r.state <= MAX_SLOTS && r.hex && !slotHex[r.state] && !hexSlot.has(r.hex)) {
      bind(r.state, r.hex);
    }
  }
  const colors = new Uint8Array(refs.length);
  let split = 0;
  let overflow = false;
  let maxSlot = 0;
  refs.forEach((r, i) => {
    let slot = 0;
    if (r.state === null) split++;
    if (r.state && r.state > 0) {
      if (r.state <= MAX_SLOTS) slot = r.state;
      else overflow = true;
    } else if (r.hex) {
      const existing = hexSlot.get(r.hex);
      if (existing !== undefined) slot = existing;
      else {
        const free = slotHex.findIndex((h, k) => k > 0 && !h);
        if (free > 0) {
          bind(free, r.hex);
          slot = free;
        } else overflow = true;
      }
    }
    colors[i] = slot;
    if (slot > maxSlot) maxSlot = slot;
  });
  if (split) warnings.push(`${split} triangle(s) with split paint were treated as Base`);
  if (overflow) warnings.push('Model uses more than 16 colors; extra colors were treated as Base');
  if (maxSlot === 0) return {};
  const groups = new Set(refs.filter((r) => r.state && r.state > 0 && r.hex).map((r) => r.group));
  const paintGroup = groups.size === 1 ? table.get([...groups][0]!) : undefined;
  if (paintGroup) {
    maxSlot = Math.max(maxSlot, Math.min(paintGroup.length - 1, MAX_SLOTS));
    for (let k = 1; k <= maxSlot; k++) {
      if (!slotHex[k] && paintGroup[k] && !hexSlot.has(paintGroup[k])) bind(k, paintGroup[k]);
    }
  }
  const defaults = defaultPalette();
  const palette: PaletteSlot[] = [{ name: 'Base', hex: defaults[0].hex }];
  const used = new Set([defaults[0].hex.toUpperCase(), ...hexSlot.keys()]);
  const candidates = defaults.slice(1).map((p) => p.hex);
  let gen = 0;
  for (let k = 1; k <= maxSlot; k++) {
    let hex = slotHex[k];
    if (!hex) {
      hex = defaults[k]?.hex;
      if (!hex || used.has(hex.toUpperCase())) {
        do hex = candidates.shift() ?? generatedHex(gen++);
        while (used.has(hex.toUpperCase()));
      }
      used.add(hex.toUpperCase());
    }
    palette.push({ name: `Color ${k}`, hex });
  }
  return { colors, palette };
}

/** Parses a 3MF package; per-triangle colors come from Bambu paint attributes or material references (the object's default material is Base). */
export function parse3mf(data: ArrayBuffer): Loaded {
  const files = unzipSync(new Uint8Array(data));
  const xml = strFromU8(files[findModelPath(files)]);
  const modelTag = /<model\b[^>]*>/.exec(xml)?.[0] ?? '';
  const unit = attr(modelTag, 'unit') ?? 'millimeter';
  const scale = UNIT_TO_MM[unit] ?? 1;
  const table = parseColorTable(xml);
  const objects = parseObjects(xml, table);
  const parts: TriMesh[] = [];
  const refs: Ref[] = [];
  const build = /<build\b[^>]*>([\s\S]*?)<\/build>/.exec(xml)?.[1] ?? '';
  for (const m of build.matchAll(/<item\b[^>]*>/g)) {
    const id = attr(m[0], 'objectid');
    if (id) collect(objects, id, parseTransform(attr(m[0], 'transform')), scale, parts, refs);
  }
  if (parts.length === 0) {
    for (const [id, obj] of objects) if (obj.mesh) collect(objects, id, IDENTITY, scale, parts, refs);
  }
  const warnings: string[] = [];
  const { colors, palette } = assignSlots(refs, table, warnings);
  const merged = mergeMeshes(parts);
  if (colors) merged.colors = colors;
  const loaded: Loaded = { mesh: weld(merged), warnings };
  if (palette) loaded.palette = palette;
  return loaded;
}
