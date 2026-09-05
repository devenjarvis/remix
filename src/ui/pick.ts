import * as THREE from 'three';
import type { FaceHit } from './app';

const normal = new THREE.Vector3();
const normalMatrix = new THREE.Matrix3();

export function pickFace(raycaster: THREE.Raycaster, meshes: THREE.Mesh[]): FaceHit | null {
  const hits = raycaster.intersectObjects(meshes, false);
  const hit = hits.find((h) => h.face && h.faceIndex !== undefined);
  if (!hit || !hit.face) return null;
  normalMatrix.getNormalMatrix(hit.object.matrixWorld);
  normal.copy(hit.face.normal).applyMatrix3(normalMatrix).normalize();
  const partIndex = meshes.indexOf(hit.object as THREE.Mesh);
  return {
    point: [hit.point.x, hit.point.y, hit.point.z],
    normal: [normal.x, normal.y, normal.z],
    partIndex,
    triangle: hit.faceIndex ?? 0,
  };
}
