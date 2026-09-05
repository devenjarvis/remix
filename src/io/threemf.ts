import { strFromU8, unzipSync } from 'fflate';
import type { TriMesh } from '../core/types';
import { mergeMeshes, weld } from '../core/trimesh';

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

interface Obj {
  mesh?: TriMesh;
  components: { id: string; transform: Mat }[];
}

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
  return { positions, indices: m.indices };
}

function parseMesh(xml: string): TriMesh {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const m of xml.matchAll(/<vertex\b[^>]*>/g)) {
    positions.push(Number(attr(m[0], 'x')), Number(attr(m[0], 'y')), Number(attr(m[0], 'z')));
  }
  for (const m of xml.matchAll(/<triangle\b[^>]*>/g)) {
    indices.push(Number(attr(m[0], 'v1')), Number(attr(m[0], 'v2')), Number(attr(m[0], 'v3')));
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

function parseObjects(xml: string): Map<string, Obj> {
  const objects = new Map<string, Obj>();
  for (const m of xml.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)) {
    const id = attr(m[1], 'id');
    if (!id) continue;
    const body = m[2];
    const obj: Obj = { components: [] };
    const mesh = /<mesh\b[^>]*>([\s\S]*?)<\/mesh>/.exec(body);
    if (mesh) obj.mesh = parseMesh(mesh[1]);
    for (const c of body.matchAll(/<component\b[^>]*>/g)) {
      const cid = attr(c[0], 'objectid');
      if (cid) obj.components.push({ id: cid, transform: parseTransform(attr(c[0], 'transform')) });
    }
    objects.set(id, obj);
  }
  return objects;
}

function collect(objects: Map<string, Obj>, id: string, t: Mat, scale: number, out: TriMesh[], depth = 0): void {
  const obj = objects.get(id);
  if (!obj || depth > 32) return;
  if (obj.mesh) out.push(apply(obj.mesh, t, scale));
  for (const c of obj.components) collect(objects, c.id, mul(t, c.transform), scale, out, depth + 1);
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

export function parse3mf(data: ArrayBuffer): TriMesh {
  const files = unzipSync(new Uint8Array(data));
  const xml = strFromU8(files[findModelPath(files)]);
  const modelTag = /<model\b[^>]*>/.exec(xml)?.[0] ?? '';
  const unit = attr(modelTag, 'unit') ?? 'millimeter';
  const scale = UNIT_TO_MM[unit] ?? 1;
  const objects = parseObjects(xml);
  const parts: TriMesh[] = [];
  const build = /<build\b[^>]*>([\s\S]*?)<\/build>/.exec(xml)?.[1] ?? '';
  for (const m of build.matchAll(/<item\b[^>]*>/g)) {
    const id = attr(m[0], 'objectid');
    if (id) collect(objects, id, parseTransform(attr(m[0], 'transform')), scale, parts);
  }
  if (parts.length === 0) {
    for (const [id, obj] of objects) if (obj.mesh) collect(objects, id, IDENTITY, scale, parts);
  }
  return weld(mergeMeshes(parts));
}
