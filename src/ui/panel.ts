import type { AppState } from './app';

export type FormHandle = { dispose?(): void };
export type FormBuilder = (host: HTMLElement, app: AppState) => FormHandle | void;

type Entry = { button: HTMLButtonElement; build: FormBuilder; needsManifold: boolean };

export class Panel {
  private entries = new Map<string, Entry>();
  private current: { name: string; handle: FormHandle | void } | null = null;

  constructor(
    private app: AppState,
    private buttons: HTMLElement,
    private formHost: HTMLElement,
  ) {
    app.onChange(() => this.update());
  }

  register(name: string, label: string, build: FormBuilder, opts: { needsManifold?: boolean } = {}): void {
    const button = document.createElement('button');
    button.textContent = label;
    button.dataset.op = name;
    button.addEventListener('click', () => (this.current?.name === name ? this.close() : this.open(name)));
    this.buttons.append(button);
    this.entries.set(name, { button, build, needsManifold: opts.needsManifold ?? false });
    this.update();
  }

  open(name: string): void {
    const entry = this.entries.get(name);
    if (!entry || entry.button.disabled) return;
    this.close();
    const handle = entry.build(this.formHost, this.app);
    this.current = { name, handle };
    entry.button.classList.add('active');
  }

  close(): void {
    if (!this.current) return;
    this.current.handle?.dispose?.();
    this.entries.get(this.current.name)?.button.classList.remove('active');
    this.current = null;
    this.formHost.replaceChildren();
  }

  private update(): void {
    const ok = this.app.canEditGeometry;
    for (const [name, e] of this.entries) {
      const disabled = e.needsManifold && !ok;
      e.button.disabled = disabled;
      e.button.title = disabled ? 'Source mesh is not manifold' : '';
      if (disabled && this.current?.name === name) this.close();
    }
  }
}
