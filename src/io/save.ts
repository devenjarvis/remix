import { BufferAttribute, BufferGeometry, Mesh } from 'three';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { hasPaint, type PaletteSlot } from '../core/color';
import type { TriMesh } from '../core/types';
import { mergeMeshes } from '../core/trimesh';
import { write3mf } from './threemf-writer';

export type ExportFormat = 'stl' | 'obj' | '3mf';

function toThreeMesh(m: TriMesh): Mesh {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(m.positions, 3));
  g.setIndex(new BufferAttribute(m.indices, 1));
  return new Mesh(g);
}

/** Serializes parts; `droppedColors` is true when the format cannot carry the mesh's paint. */
export function exportModel(
  parts: TriMesh | TriMesh[],
  format: ExportFormat,
  name: string,
  palette?: PaletteSlot[],
): { bytes: Uint8Array; droppedColors: boolean } {
  const list = Array.isArray(parts) ? parts : [parts];
  const painted = list.some(hasPaint);
  switch (format) {
    case 'stl': {
      const merged = mergeMeshes(list);
      const out = new STLExporter().parse(toThreeMesh(merged), { binary: true });
      return { bytes: new Uint8Array(out.buffer, out.byteOffset, out.byteLength), droppedColors: painted };
    }
    case 'obj': {
      const merged = mergeMeshes(list);
      return { bytes: new TextEncoder().encode(new OBJExporter().parse(toThreeMesh(merged))), droppedColors: painted };
    }
    case '3mf':
      return { bytes: write3mf(list, name, palette), droppedColors: false };
  }
}
