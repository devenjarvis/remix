type Attrs = Record<string, string | number | boolean | EventListener>;
type Child = Node | string;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') node.addEventListener(k.replace(/^on/, '').toLowerCase(), v);
    else if (k === 'class') node.className = String(v);
    else if (typeof v === 'boolean') (node as unknown as Record<string, boolean>)[k] = v;
    else node.setAttribute(k, String(v));
  }
  for (const c of children) node.append(c);
  return node;
}

export function row(label: string, ...inputs: Child[]): HTMLDivElement {
  return el('div', { class: 'row' }, [el('label', {}, [label]), ...inputs]);
}

export function numberInput(value: number, opts: { step?: number; min?: number } = {}): HTMLInputElement {
  const input = el('input', { type: 'number', step: opts.step ?? 0.1 });
  if (opts.min !== undefined) input.min = String(opts.min);
  input.value = String(value);
  return input;
}

export function select<T extends string>(options: [T, string][], value: T): HTMLSelectElement {
  const s = el('select', {}, options.map(([v, label]) => el('option', { value: v }, [label])));
  s.value = value;
  return s;
}

/** Slot selector built from the app palette; option values are slot indices. */
export function colorSelect(app: { palette: { name: string; hex: string }[] }, value: number): HTMLSelectElement {
  const s = el('select', {}, app.palette.map((p, i) => el('option', { value: String(i) }, [i === 0 ? 'Base' : `${i}: ${p.name}`])));
  s.value = String(Math.min(value, app.palette.length - 1));
  return s;
}

export function hint(text = ''): HTMLDivElement {
  return el('div', { class: 'hint' }, [text]);
}

export function actions(...buttons: HTMLButtonElement[]): HTMLDivElement {
  return el('div', { class: 'actions' }, buttons);
}

export const fmt = (n: number): string => String(Math.round(n * 100) / 100);
