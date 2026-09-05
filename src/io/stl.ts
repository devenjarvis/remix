import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import type { TriMesh } from '../core/types';
import { weld } from '../core/trimesh';
import { fromGeometry } from './geometry';

export function parseStl(data: ArrayBuffer): TriMesh {
  return weld(fromGeometry(new STLLoader().parse(data)));
}
