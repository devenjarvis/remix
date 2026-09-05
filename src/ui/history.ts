import type { AppState } from './app';
import { describeOp } from '../core/ops/types';
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
        el('span', { class: 'label' }, [describeOp(op)]),
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
  }
}
