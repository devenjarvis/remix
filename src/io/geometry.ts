import type { BufferGeometry, Object3D } from 'three';
import { Matrix4, Mesh, Vector3 } from 'three';
import type { TriMesh } from '../core/types';
import { mergeMeshes, weld } from '../core/trimesh';

export function fromGeometry(g: BufferGeometry, matrix?: Matrix4): TriMesh {
  const pos = g.getAttribute('position');
  const positions = new Float32Array(pos.count * 3);
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (matrix) v.applyMatrix4(matrix);
    positions[i * 3] = v.x;
    positions[i * 3 + 1] = v.y;
    positions[i * 3 + 2] = v.z;
  }
  const idx = g.getIndex();
  const indices = idx ? new Uint32Array(idx.array) : Uint32Array.from({ length: pos.count }, (_, i) => i);
  return { positions, indices };
}

export function fromObject(root: Object3D): TriMesh {
  root.updateMatrixWorld(true);
  const parts: TriMesh[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh) parts.push(fromGeometry(o.geometry, o.matrixWorld));
  });
  return weld(mergeMeshes(parts));
}
