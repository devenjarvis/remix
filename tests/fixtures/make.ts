import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';

const dir = dirname(fileURLToPath(import.meta.url));
const s = 10;
const verts: number[][] = [
  [0, 0, 0], [s, 0, 0], [s, s, 0], [0, s, 0],
  [0, 0, s], [s, 0, s], [s, s, s], [0, s, s],
];
const faces: number[][] = [
  [0, 3, 2], [0, 2, 1],
  [4, 5, 6], [4, 6, 7],
  [0, 1, 5], [0, 5, 4],
  [1, 2, 6], [1, 6, 5],
  [2, 3, 7], [2, 7, 6],
  [3, 0, 4], [3, 4, 7],
];

function normal(f: number[]): number[] {
  const [a, b, c] = f.map((i) => verts[i]);
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const len = Math.hypot(...n);
  return n.map((x) => x / len);
}

function binaryStl(): Uint8Array {
  const buf = new ArrayBuffer(84 + faces.length * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, faces.length, true);
  faces.forEach((f, i) => {
    let o = 84 + i * 50;
    const n = normal(f);
    for (const x of n) { dv.setFloat32(o, x, true); o += 4; }
    for (const vi of f) for (const x of verts[vi]) { dv.setFloat32(o, x, true); o += 4; }
    dv.setUint16(o, 0, true);
  });
  return new Uint8Array(buf);
}

function asciiStl(): string {
  const lines = ['solid cube'];
  for (const f of faces) {
    lines.push(`  facet normal ${normal(f).join(' ')}`, '    outer loop');
    for (const vi of f) lines.push(`      vertex ${verts[vi].join(' ')}`);
    lines.push('    endloop', '  endfacet');
  }
  lines.push('endsolid cube', '');
  return lines.join('\n');
}

function obj(): string {
  const lines = ['# cube', 'o cube'];
  for (const v of verts) lines.push(`v ${v.join(' ')}`);
  for (const f of faces) lines.push(`f ${f.map((i) => i + 1).join(' ')}`);
  lines.push('');
  return lines.join('\n');
}

type ThreeMfOptions = {
  materials?: string;
  objectAttrs?: string;
  triangleAttrs?: Record<number, string>;
};

function threeMf(unit: string, opts: ThreeMfOptions = {}): Uint8Array {
  const vs = verts.map((v) => `<vertex x="${v[0]}" y="${v[1]}" z="${v[2]}"/>`).join('');
  const ts = faces
    .map((f, i) => `<triangle v1="${f[0]}" v2="${f[1]}" v3="${f[2]}"${opts.triangleAttrs?.[i] ?? ''}/>`)
    .join('');
  const ns = opts.materials ? ' xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02"' : '';
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="${unit}" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"${ns}>
<resources>${opts.materials ?? ''}<object id="1" type="model"${opts.objectAttrs ?? ''}><mesh><vertices>${vs}</vertices><triangles>${ts}</triangles></mesh></object></resources>
<build><item objectid="1"/></build>
</model>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;
  return zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    '3D/3dmodel.model': strToU8(model),
  });
}

writeFileSync(join(dir, 'cube.stl'), binaryStl());
writeFileSync(join(dir, 'cube-ascii.stl'), asciiStl());
writeFileSync(join(dir, 'cube.obj'), obj());
writeFileSync(join(dir, 'cube.3mf'), threeMf('millimeter'));
writeFileSync(join(dir, 'cube-inch.3mf'), threeMf('inch'));
writeFileSync(
  join(dir, 'cube-colors.3mf'),
  threeMf('millimeter', {
    materials: '<m:colorgroup id="1"><m:color color="#ff0000"/><m:color color="#0000ff"/></m:colorgroup>',
    triangleAttrs: { 0: ' pid="1" p1="1"', 1: ' pid="1" p1="1"', 2: ' pid="1" p1="0"', 3: ' pid="1" p1="0"' },
  }),
);
writeFileSync(
  join(dir, 'cube-basematerials.3mf'),
  threeMf('millimeter', {
    materials: '<basematerials id="1"><base name="Red" displaycolor="#FF0000FF"/><base name="Blue" displaycolor="#0000FFFF"/></basematerials>',
    objectAttrs: ' pid="1" pindex="0"',
    triangleAttrs: { 0: ' p1="1"', 1: ' p1="1"' },
  }),
);
writeFileSync(
  join(dir, 'cube-paint.3mf'),
  threeMf('millimeter', {
    triangleAttrs: { 0: ' paint_color="4"', 1: ' paint_color="4"', 2: ' paint_color="8"', 3: ' paint_color="8"' },
  }),
);
