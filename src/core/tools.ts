import type { Manifold } from 'manifold-3d';
import { manifold } from './manifold';
import type { ToolBody } from './ops/types';
import { toManifold } from './trimesh';
import type { Mat4 } from './mat4';

export const TOOL_SEGMENTS = 64;

export function toolManifold(tool: ToolBody, matrix?: Mat4): Manifold {
  const { Manifold } = manifold();
  let m: Manifold;
  switch (tool.kind) {
    case 'box':
      m = Manifold.cube(tool.size, true);
      break;
    case 'cylinder': {
      const [dx, dy, dz] = tool.size;
      m = Manifold.cylinder(dz, dx / 2, dx / 2, TOOL_SEGMENTS, true).scale([1, dy / dx, 1]);
      break;
    }
    case 'sphere': {
      const [dx, dy, dz] = tool.size;
      m = Manifold.sphere(dx / 2, TOOL_SEGMENTS).scale([1, dy / dx, dz / dx]);
      break;
    }
    case 'mesh':
      m = toManifold({ positions: Float32Array.from(tool.positions), indices: Uint32Array.from(tool.indices) });
      break;
  }
  if (matrix) {
    const t = m.transform(matrix as Parameters<Manifold['transform']>[0]);
    m.delete();
    return t;
  }
  return m;
}
