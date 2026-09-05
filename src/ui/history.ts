import type { AppState } from './app';
import { describeOp, type Op } from '../core/ops/types';
import { el } from './dom';

export class HistoryPanel {
  constructor(
    private readonly app: AppState,
    private readonly list: HTMLElement,
    private readonly undoBtn: HTMLButtonElement,
    private readonly redoBtn: HTMLButtonElement,
  ) {
    undoBtn.addEventListener('click', () => app.history.undo());
    redoBtn.addEventListener('click', () => app.history.redo());
    document.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      e.preventDefault();
      if (e.shiftKey) app.history.redo();
      else app.history.undo();
    });
    app.onChange(() => this.render());
    this.render();
  }

  private label(op: Op): string {
    if (op.type !== 'paint') return describeOp(op);
    const slot = this.app.palette[op.color];
    return `Paint ${op.color === 0 ? 'Base' : slot?.name ?? `slot ${op.color}`} (${op.select.kind})`;
  }

  render(): void {
    const { history } = this.app;
    this.undoBtn.disabled = history.cursor === 0;
    this.redoBtn.disabled = history.cursor >= history.ops.length;
    this.list.replaceChildren();
    const source = el('li', { class: history.cursor === 0 ? 'current' : '' }, [
      el('span', { class: 'label' }, [this.app.source ? `Source: ${this.app.sourceName}` : 'No model']),
    ]);
    source.addEventListener('click', () => history.truncateTo(0));
    this.list.append(source);
    history.ops.forEach((op, i) => {
      const active = i < history.cursor;
      const item = el('li', { class: [i === history.cursor - 1 ? 'current' : '', active ? '' : 'undone'].join(' ').trim() }, [
        el('span', { class: 'label' }, [this.label(op)]),
      ]);
      const del = el('button', { class: 'del', title: 'Delete this step' }, ['×']);
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        history.remove(op.id);
      });
      item.addEventListener('click', () => history.truncateTo(i + 1));
      item.append(del);
      this.list.append(item);
    });
    if (this.app.preview) {
      this.list.append(el('li', { class: 'preview' }, [el('span', { class: 'label' }, [`Preview: ${this.label(this.app.preview)}`])]));
    }
  }
}
