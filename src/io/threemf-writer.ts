import { strToU8, zipSync } from 'fflate';
import { defaultPalette, hasPaint, type PaletteSlot } from '../core/color';
import type { TriMesh } from '../core/types';
import { encodePaintColor } from './color3mf';

const MATERIAL_NS = 'http://schemas.microsoft.com/3dmanufacturing/material/2015/02';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>
`;

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
`;

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(6).replace(/\.?0+$/, '');
}

function objectXml(m: TriMesh, id: number, name: string, colored: boolean): string {
  const parts: string[] = [];
  const objAttrs = colored ? ' pid="1" pindex="0"' : '';
  parts.push(`    <object id="${id}" name="${escapeXml(name)}" type="model"${objAttrs}>\n      <mesh>\n        <vertices>\n`);
  const p = m.positions;
  for (let i = 0; i < p.length; i += 3) {
    parts.push(`          <vertex x="${fmt(p[i])}" y="${fmt(p[i + 1])}" z="${fmt(p[i + 2])}"/>\n`);
  }
  parts.push(`        </vertices>\n        <triangles>\n`);
  const t = m.indices;
  const c = colored ? m.colors : undefined;
  for (let i = 0; i < t.length; i += 3) {
    const slot = c ? c[i / 3] : 0;
    const extra = slot > 0 ? ` pid="1" p1="${slot}" paint_color="${encodePaintColor(slot)}"` : '';
    parts.push(`          <triangle v1="${t[i]}" v2="${t[i + 1]}" v3="${t[i + 2]}"${extra}/>\n`);
  }
  parts.push(`        </triangles>\n      </mesh>\n    </object>\n`);
  return parts.join('');
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}

function checkPalette(parts: TriMesh[], palette: PaletteSlot[]): void {
  const seen = new Set<string>();
  for (const p of palette) {
    const hex = p.hex.toLowerCase();
    if (seen.has(hex)) throw new Error('Palette has duplicate colors; Bambu Studio would merge them into one filament');
    seen.add(hex);
  }
  for (const m of parts) {
    if (!m.colors) continue;
    for (let i = 0; i < m.colors.length; i++) {
      if (m.colors[i] > palette.length - 1) {
        throw new Error(`Triangle uses color slot ${m.colors[i]} but the palette has ${palette.length} slots`);
      }
    }
  }
}

/** Writes parts as 3MF objects; painted parts add a material color group and per-triangle Bambu paint attributes. */
export function write3mf(parts: TriMesh[], name: string, palette?: PaletteSlot[]): Uint8Array {
  const colored = parts.some(hasPaint);
  const pal = colored ? palette ?? defaultPalette() : null;
  if (pal) checkPalette(parts, pal);
  const offset = pal ? 1 : 0;
  const objects = parts
    .map((m, i) => objectXml(m, i + 1 + offset, parts.length > 1 ? `${name}-${i + 1}` : name, colored))
    .join('');
  const items = parts.map((_, i) => `    <item objectid="${i + 1 + offset}"/>\n`).join('');
  const ns = pal ? ` xmlns:m="${MATERIAL_NS}"` : '';
  const colorGroup = pal
    ? `    <m:colorgroup id="1">\n${pal.map((p) => `      <m:color color="${p.hex}"/>\n`).join('')}    </m:colorgroup>\n`
    : '';
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"${ns}>
  <metadata name="Application">Remix</metadata>
  <resources>
${colorGroup}${objects}  </resources>
  <build>
${items}  </build>
</model>
`;
  return zipSync(
    {
      '[Content_Types].xml': strToU8(CONTENT_TYPES),
      '_rels/.rels': strToU8(RELS),
      '3D/3dmodel.model': strToU8(model),
    },
    { level: 6 },
  );
}
