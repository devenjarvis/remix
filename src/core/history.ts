import type { Op, Recipe } from './ops/types';

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
    this.ops.push(op);
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

  toJSON(): Recipe {
    return { version: 1, ops: this.active.map((o) => ({ ...o })) };
  }

  static fromJSON(r: Recipe): History {
    if (r.version !== 1) throw new Error(`Unsupported recipe version: ${String(r.version)}`);
    const h = new History();
    h.ops = r.ops.map((o) => ({ ...o }));
    h.cursor = h.ops.length;
    return h;
  }
}
