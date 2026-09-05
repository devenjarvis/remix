import { BufferAttribute, BufferGeometry, Mesh } from 'three';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
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

export function exportModel(parts: TriMesh | TriMesh[], format: ExportFormat, name: string): Uint8Array {
  const list = Array.isArray(parts) ? parts : [parts];
  switch (format) {
    case 'stl': {
      const merged = mergeMeshes(list);
      const out = new STLExporter().parse(toThreeMesh(merged), { binary: true });
      return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
    }
    case 'obj': {
      const merged = mergeMeshes(list);
      return new TextEncoder().encode(new OBJExporter().parse(toThreeMesh(merged)));
    }
    case '3mf':
      return write3mf(list, name);
  }
}
