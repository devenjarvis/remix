import { strToU8, zipSync } from 'fflate';
import type { TriMesh } from '../core/types';

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

function objectXml(m: TriMesh, id: number, name: string): string {
  const parts: string[] = [];
  parts.push(`    <object id="${id}" name="${escapeXml(name)}" type="model">\n      <mesh>\n        <vertices>\n`);
  const p = m.positions;
  for (let i = 0; i < p.length; i += 3) {
    parts.push(`          <vertex x="${fmt(p[i])}" y="${fmt(p[i + 1])}" z="${fmt(p[i + 2])}"/>\n`);
  }
  parts.push(`        </vertices>\n        <triangles>\n`);
  const t = m.indices;
  for (let i = 0; i < t.length; i += 3) {
    parts.push(`          <triangle v1="${t[i]}" v2="${t[i + 1]}" v3="${t[i + 2]}"/>\n`);
  }
  parts.push(`        </triangles>\n      </mesh>\n    </object>\n`);
  return parts.join('');
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}

export function write3mf(parts: TriMesh[], name: string): Uint8Array {
  const objects = parts.map((m, i) => objectXml(m, i + 1, parts.length > 1 ? `${name}-${i + 1}` : name)).join('');
  const items = parts.map((_, i) => `    <item objectid="${i + 1}"/>\n`).join('');
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Application">Remix</metadata>
  <resources>
${objects}  </resources>
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
