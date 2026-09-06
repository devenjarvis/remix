import type { TriMesh } from './types';

export type PaletteSlot = { name: string; hex: string };

/** Filament slots 1..MAX_SLOTS; slot 0 is Base. */
export const MAX_SLOTS = 16;

export const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function defaultPalette(): PaletteSlot[] {
  return [
    { name: 'Base', hex: '#b8c4d6' },
    { name: 'Color 1', hex: '#e04b3a' },
    { name: 'Color 2', hex: '#3a8fe0' },
    { name: 'Color 3', hex: '#4bb84b' },
    { name: 'Color 4', hex: '#f0c419' },
  ];
}

export function hasPaint(m: TriMesh): boolean {
  if (!m.colors) return false;
  for (let i = 0; i < m.colors.length; i++) if (m.colors[i] !== 0) return true;
  return false;
}
