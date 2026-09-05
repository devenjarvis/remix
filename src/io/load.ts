import type { TriMesh } from '../core/types';
import { parseObj } from './obj';
import { parseStl } from './stl';
import { parse3mf } from './threemf';

const parsers: Record<string, (data: ArrayBuffer) => TriMesh> = {
  stl: parseStl,
  obj: parseObj,
  '3mf': parse3mf,
};

export async function loadModel(name: string, data: ArrayBuffer): Promise<TriMesh> {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  const parse = parsers[ext];
  if (!parse) throw new Error(`Unsupported file type: .${ext}`);
  return parse(data);
}
