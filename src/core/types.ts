export type Vec3 = [number, number, number];

export interface TriMesh {
  positions: Float32Array;
  indices: Uint32Array;
  /** One slot per triangle: 0 is Base, 1..16 are filament slots. Absent means all Base. */
  colors?: Uint8Array;
}

export interface Bounds {
  min: Vec3;
  max: Vec3;
  size: Vec3;
}
