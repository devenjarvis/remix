import type { AppState } from './app';
import { triangleCount } from '../core/trimesh';

const mm = (n: number) => n.toFixed(1);

export class StatusBar {
  constructor(
    private readonly app: AppState,
    private readonly size: HTMLElement,
    private readonly tris: HTMLElement,
    private readonly manifold: HTMLElement,
    private readonly msg: HTMLElement,
  ) {
    app.onChange(() => this.render());
    this.render();
  }

  setMessage(text: string, kind: '' | 'ok' | 'warn' | 'err' = ''): void {
    this.msg.textContent = text;
    this.msg.className = kind;
  }

  render(): void {
    const { app } = this;
    const b = app.bounds;
    if (!app.source || !b) {
      this.size.textContent = 'No model';
      this.tris.textContent = '';
      this.manifold.textContent = '';
      return;
    }
    const parts = app.parts;
    this.size.textContent = `${mm(b.size[0])} × ${mm(b.size[1])} × ${mm(b.size[2])} mm` + (app.preview ? ' (preview)' : '');
    const n = parts.reduce((s, p) => s + triangleCount(p), 0);
    this.tris.textContent = `${n.toLocaleString()} tris` + (parts.length > 1 ? `, ${parts.length} parts` : '');
    if (app.busy) {
      this.manifold.textContent = 'Working…';
      this.manifold.className = '';
      return;
    }
    const r = app.result;
    if (!r) {
      this.manifold.textContent = '';
      return;
    }
    if (r.error) {
      this.manifold.textContent = `Error: ${r.error}`;
      this.manifold.className = 'err';
    } else if (r.manifold && r.status === 'NoError') {
      this.manifold.textContent = 'Manifold';
      this.manifold.className = 'ok';
    } else {
      this.manifold.textContent = /not manifold/i.test(r.status) ? 'Not manifold' : `Not manifold (${r.status})`;
      this.manifold.className = 'warn';
    }
  }
}
