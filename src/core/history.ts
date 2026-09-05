import type { Op, Recipe } from './ops/types';
import type { PaletteSlot } from './color';
import { validateOp, validateRecipe } from './ops/validate';
import { consolidatePaints } from './ops/paint';

type Listener = () => void;

export class History {
  ops: Op[] = [];
  cursor = 0;
  private listeners = new Set<Listener>();

  onChange(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    for (const cb of this.listeners) cb();
  }

  get active(): Op[] {
    return this.ops.slice(0, this.cursor);
  }

  push(op: Op): void {
    this.ops = this.ops.slice(0, this.cursor);
    this.ops.push(validateOp(op));
    this.cursor = this.ops.length;
    this.emit();
  }

  pushAll(ops: Op[]): void {
    if (!ops.length) return;
    this.ops = this.ops.slice(0, this.cursor).concat(ops.map(validateOp));
    this.cursor = this.ops.length;
    this.emit();
  }

  undo(): boolean {
    if (this.cursor === 0) return false;
    this.cursor--;
    this.emit();
    return true;
  }

  redo(): boolean {
    if (this.cursor >= this.ops.length) return false;
    this.cursor++;
    this.emit();
    return true;
  }

  truncateTo(i: number): void {
    const next = Math.max(0, Math.min(i, this.ops.length));
    if (next === this.cursor) return;
    this.cursor = next;
    this.emit();
  }

  remove(id: string): void {
    const i = this.ops.findIndex((o) => o.id === id);
    if (i < 0) return;
    this.ops.splice(i, 1);
    if (i < this.cursor) this.cursor--;
    this.emit();
  }

  clear(): void {
    this.ops = [];
    this.cursor = 0;
    this.emit();
  }

  /** Version 2 carries the palette; without one the recipe stays version 1. */
  get canMergePaints(): boolean {
    return consolidatePaints(this.active).length < this.cursor;
  }

  /** Merges consecutive same-color paint steps in the active history; the redo tail is kept. */
  mergePaints(): void {
    const merged = consolidatePaints(this.active);
    if (merged.length === this.cursor) return;
    this.ops = merged.concat(this.ops.slice(this.cursor));
    this.cursor = merged.length;
    this.emit();
  }

  toJSON(palette?: PaletteSlot[]): Recipe {
    const ops = consolidatePaints(this.active).map((o) => ({ ...o }));
    return palette ? { version: 2, palette: palette.map((s) => ({ ...s })), ops } : { version: 1, ops };
  }

  static fromJSON(r: unknown): History {
    const recipe = validateRecipe(r);
    const h = new History();
    h.ops = recipe.ops.map((o) => ({ ...o }));
    h.cursor = h.ops.length;
    return h;
  }
}
