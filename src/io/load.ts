import type { PaletteSlot } from '../core/color';
import type { TriMesh } from '../core/types';
import { parseObj } from './obj';
import { parseStl } from './stl';
import { parse3mf } from './threemf';
import { validateMesh } from '../core/trimesh';

export type Loaded = { mesh: TriMesh; palette?: PaletteSlot[]; warnings: string[] };

const parsers: Record<string, (data: ArrayBuffer) => Loaded> = {
  stl: (data) => ({ mesh: parseStl(data), warnings: [] }),
  obj: (data) => ({ mesh: parseObj(data), warnings: [] }),
  '3mf': parse3mf,
};

export async function loadModel(name: string, data: ArrayBuffer): Promise<Loaded> {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  const parse = parsers[ext];
  if (!parse) throw new Error(`Unsupported file type: .${ext}`);
  const loaded = parse(data);
  validateMesh(loaded.mesh);
  return loaded;
}
