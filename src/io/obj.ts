import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import type { TriMesh } from '../core/types';
import { fromObject } from './geometry';

export function parseObj(data: ArrayBuffer): TriMesh {
  return fromObject(new OBJLoader().parse(new TextDecoder().decode(data)));
}
