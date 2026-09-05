export type Vec3 = [number, number, number];

export interface TriMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

export interface Bounds {
  min: Vec3;
  max: Vec3;
  size: Vec3;
}
